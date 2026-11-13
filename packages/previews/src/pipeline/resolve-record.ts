// Find where an opportunity is and, when possible, render a satellite image of it.
//
// Candidates come from cheap sources first (title, then the display locality), then from the
// opportunity's pages, then from attached PDFs. The first candidate that geocodes becomes the
// locator; the first one that also yields a usable image wins.
import { dedupeAddressCandidates, getAddressCandidateComparisonKey } from "../address/compare";
import { extractAddressCandidatesFromText } from "../address/extract";
import {
  extractAddressCandidatesFromPdfUrls,
  fetchOpportunityPageLocationSignals,
} from "../documents/signals";
import { geocodePreciseAddress } from "../geocode/geocoder";
import {
  buildLocalityCandidatesFromAddressHints,
  resolveOpportunityLocalityCandidates,
} from "../geocode/queries";
import { isInvalidSatellitePreviewBuffer } from "../render/quality";
import { renderSatellitePreview } from "../render/satellite";
import type { AddressCandidate, PreviewOpportunity, SatellitePreviewPrecision } from "../types";
import type { RecordContext } from "./context";

export type OpportunityLocator = {
  label: string;
  lat: number;
  lng: number;
  precision: SatellitePreviewPrecision;
};

export type SatelliteResolution = {
  image: Buffer | null;
  locator: OpportunityLocator | null;
};

/** Below this confidence the stored point is not precise enough to spend tiles on. */
const STORED_COORDINATE_MIN_CONFIDENCE = 0.5;

/**
 * The record's own geocoded point. The worker already resolves the place (now with an AI-assisted
 * pass), so the batch job does not need to geocode and crawl the notice again: it crops the tiles
 * straight at the stored coordinates. A country centroid is not a place and is refused, since it
 * would frame the middle of the country instead of the site.
 */
export const readStoredLocator = (opportunity: PreviewOpportunity): OpportunityLocator | null => {
  const { geoLat, geoLng } = opportunity;
  if (geoLat === null || geoLat === undefined || geoLng === null || geoLng === undefined) {
    return null;
  }
  if (!Number.isFinite(geoLat) || !Number.isFinite(geoLng)) {
    return null;
  }
  const source = (opportunity.geoSource ?? "").trim().toLowerCase();
  if (source.endsWith(":country")) {
    return null;
  }
  const confidence = opportunity.geoConfidence;
  if (confidence !== null && confidence !== undefined && confidence < STORED_COORDINATE_MIN_CONFIDENCE) {
    return null;
  }
  return {
    label: opportunity.locationLabel?.trim() || opportunity.jurisdictionLabel,
    lat: geoLat,
    lng: geoLng,
    precision: "locality",
  };
};

export const resolveOpportunitySatellite = async (
  context: RecordContext,
  opportunity: PreviewOpportunity,
): Promise<SatelliteResolution> => {
  const geocodingContext = { budget: context.budget, services: context.geocoding };
  const documentContext = { budget: context.budget, fetcher: context.documentFetcher };
  let locator: OpportunityLocator | null = null;

  const tryCandidates = async (candidates: AddressCandidate[]): Promise<Buffer | null> => {
    for (const candidate of candidates) {
      if (!context.budget.hasRoom()) {
        return null;
      }
      const geocode = await geocodePreciseAddress(geocodingContext, opportunity, candidate);
      if (!geocode) {
        continue;
      }

      const place: OpportunityLocator = {
        label: candidate.localityHint ?? candidate.address,
        lat: geocode.lat,
        lng: geocode.lng,
        precision: geocode.precision,
      };
      locator ??= place;
      const image = await renderSatellitePreview(
        context,
        geocode.lat,
        geocode.lng,
        candidate,
        geocode.precision,
      );
      if (image && !(await isInvalidSatellitePreviewBuffer(image))) {
        locator = place;
        return image;
      }
      context.log("candidate-render-failed", { slug: opportunity.slug });
    }
    return null;
  };
  const done = (image: Buffer | null): SatelliteResolution => ({ image, locator });

  // Stored coordinates first: one tile fetch instead of a second geocode and page crawl.
  const stored = readStoredLocator(opportunity);
  if (stored) {
    locator = stored;
    const image = await renderSatellitePreview(
      context,
      stored.lat,
      stored.lng,
      {
        address: stored.label,
        kind: "locality",
        localityHint: opportunity.locationLabel,
        source: "title",
      },
      stored.precision,
    );
    if (image && !(await isInvalidSatellitePreviewBuffer(image))) {
      return done(image);
    }
    context.log("stored-coordinate-render-failed", { slug: opportunity.slug });
  }

  const titleCandidates = extractAddressCandidatesFromText(opportunity.title, "title");
  const localityCandidates = resolveOpportunityLocalityCandidates(opportunity);
  const titleHintLocalityCandidates = buildLocalityCandidatesFromAddressHints(titleCandidates);
  const fromTitle = await tryCandidates(
    dedupeAddressCandidates([
      ...titleCandidates,
      ...localityCandidates,
      ...titleHintLocalityCandidates,
    ]),
  );
  if (fromTitle) {
    return done(fromTitle);
  }

  const signals = await fetchOpportunityPageLocationSignals(documentContext, opportunity);
  const pageSignalCandidates = dedupeAddressCandidates([
    ...signals.structuredCandidates,
    ...signals.textCandidates,
  ]);
  const seen = new Set(
    [...titleCandidates, ...localityCandidates, ...titleHintLocalityCandidates].map(
      getAddressCandidateComparisonKey,
    ),
  );
  const unseen = (candidates: AddressCandidate[]) => {
    const fresh = candidates.filter((candidate) => !seen.has(getAddressCandidateComparisonKey(candidate)));
    fresh.forEach((candidate) => seen.add(getAddressCandidateComparisonKey(candidate)));
    return fresh;
  };
  const pageCandidates = unseen(pageSignalCandidates);
  const pageLocalityCandidates = unseen(buildLocalityCandidatesFromAddressHints(pageSignalCandidates));
  const fromPage = await tryCandidates([...pageCandidates, ...pageLocalityCandidates]);
  if (fromPage) {
    return done(fromPage);
  }

  const pdfCandidates = unseen(
    await extractAddressCandidatesFromPdfUrls(
      documentContext,
      signals.pdfCandidates.map((candidate) => candidate.url),
    ),
  );
  return done(await tryCandidates(pdfCandidates));
};
