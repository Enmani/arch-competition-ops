// Find and download the official image of an opportunity published on the Stadt Zuerich site.
//
// Offline only. Previously the Web route did this per request and proxied the remote image to the
// browser; now the image is fetched once through the SSRF-guarded fetcher, re-encoded, and stored
// like any other preview.
import sharp from "sharp";

import { getHostname, hostMatches } from "../documents/urls";
import type { DocumentContext } from "../documents/fetch";
import type { PreviewOpportunity } from "../types";
import {
  extractRelatedPreviewPageUrlsFromJsonPayload,
  resolvePageUrl,
  simapHosts,
} from "./related-pages";
import { resolvePreviewImageUrlFromHtml, resolvePreviewImageUrlFromJson } from "./scoring";

const stadtZurichHosts = ["stadt-zuerich.ch"];
const PAGE_TIMEOUT_MS = 6500;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 10_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MAX_RELATED_PAGES = 3;
const MAX_OUTPUT_EDGE_PX = 1200;

type OfficialImageInput = Pick<
  PreviewOpportunity,
  "briefPdfUrl" | "documentsPortalUrl" | "officialUrl" | "sourceUrl"
>;

export const isStadtZurichOpportunitySource = (opportunity: OfficialImageInput) =>
  [
    opportunity.officialUrl,
    opportunity.sourceUrl,
    opportunity.documentsPortalUrl,
    opportunity.briefPdfUrl,
  ].some((url) => hostMatches(getHostname(url), stadtZurichHosts));

const findImageUrlOnPage = async (
  context: DocumentContext,
  pageUrl: string,
  visited: Set<string>,
): Promise<string | null> => {
  const normalized = resolvePageUrl(pageUrl, pageUrl) ?? pageUrl;
  if (visited.has(normalized) || !context.budget.spend()) {
    return null;
  }
  visited.add(normalized);

  const page = await context.fetcher(normalized, {
    accept: "text/html,application/xhtml+xml,application/json",
    maxBytes: PAGE_MAX_BYTES,
    timeoutMs: Math.min(PAGE_TIMEOUT_MS, context.budget.remainingMs()),
  });
  if (!page || page.status < 200 || page.status >= 300) {
    return null;
  }

  const text = page.body.toString("utf8");
  if (page.contentType.includes("application/json")) {
    const direct = resolvePreviewImageUrlFromJson(text, page.url);
    if (direct || !hostMatches(getHostname(page.url), simapHosts)) {
      return direct;
    }
    const related = extractRelatedPreviewPageUrlsFromJsonPayload(text, page.url);
    for (const relatedUrl of related.slice(0, MAX_RELATED_PAGES)) {
      const found = await findImageUrlOnPage(context, relatedUrl, visited);
      if (found) {
        return found;
      }
    }
    return null;
  }
  return page.contentType.includes("text/html") ? resolvePreviewImageUrlFromHtml(text, page.url) : null;
};

export const resolveOpportunityCardImageUrl = async (
  context: DocumentContext,
  opportunity: OfficialImageInput,
): Promise<string | null> => {
  const visited = new Set<string>();
  const pages = [
    opportunity.documentsPortalUrl,
    opportunity.officialUrl,
    opportunity.sourceUrl,
    opportunity.briefPdfUrl,
  ].filter((pageUrl): pageUrl is string => typeof pageUrl === "string" && pageUrl.length > 0);

  for (const pageUrl of new Set(pages)) {
    const imageUrl = await findImageUrlOnPage(context, pageUrl, visited);
    if (imageUrl) {
      return imageUrl;
    }
  }
  return null;
};

export type OfficialImage = { attribution: string; image: Buffer };

/** The official image as a re-encoded JPEG, or null when there is none or it cannot be used. */
export const fetchOfficialCardImage = async (
  context: DocumentContext,
  opportunity: OfficialImageInput,
): Promise<OfficialImage | null> => {
  if (!isStadtZurichOpportunitySource(opportunity)) {
    return null;
  }
  const imageUrl = await resolveOpportunityCardImageUrl(context, opportunity);
  if (!imageUrl || !context.budget.spend()) {
    return null;
  }

  const download = await context.fetcher(imageUrl, {
    accept: "image/avif,image/webp,image/apng,image/*;q=0.8",
    maxBytes: IMAGE_MAX_BYTES,
    timeoutMs: Math.min(IMAGE_TIMEOUT_MS, context.budget.remainingMs()),
  });
  if (!download || download.status < 200 || download.status >= 300) {
    return null;
  }
  if (!download.contentType.startsWith("image/") || download.contentType.includes("svg")) {
    return null;
  }

  try {
    const image = await sharp(download.body, { limitInputPixels: 80_000_000 })
      .rotate()
      .resize({
        fit: "inside",
        height: MAX_OUTPUT_EDGE_PX,
        width: MAX_OUTPUT_EDGE_PX,
        withoutEnlargement: true,
      })
      .jpeg({ mozjpeg: true, quality: 82 })
      .toBuffer();
    return { attribution: `Image source: ${getHostname(imageUrl)}`, image };
  } catch {
    return null;
  }
};
