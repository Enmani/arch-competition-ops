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
