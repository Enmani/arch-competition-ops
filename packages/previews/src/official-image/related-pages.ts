// SIMAP notices are JSON; the page that carries the image is a related portal named inside them.
import { resolveImageUrl } from "./scoring";

export const simapHosts = ["simap.ch"];

const resolvePageUrl = (candidate: string | null | undefined, pageUrl: string) => {
  const trimmed = candidate?.trim();
  if (!trimmed) {
    return null;
  }
  return resolveImageUrl(/^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed, pageUrl);
};

const extractUrlsFromText = (value: string) => {
  const urls: string[] = [];
  for (const match of value.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi)) {
    const candidate = match[0]?.replace(/[),.;:]+$/g, "");
    if (candidate) {
      urls.push(candidate);
    }
  }
  return urls;
};

const collectRelatedPageUrls = (
  value: unknown,
  pageUrl: string,
  target: Set<string>,
  extractBareUrls = false,
) => {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    for (const candidate of extractBareUrls ? extractUrlsFromText(value) : [value]) {
      const resolved = resolvePageUrl(candidate, pageUrl);
      if (resolved) {
        target.add(resolved);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectRelatedPageUrls(entry, pageUrl, target, extractBareUrls));
    return;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((entry) =>
      collectRelatedPageUrls(entry, pageUrl, target, extractBareUrls),
    );
  }
};

export const extractRelatedPreviewPageUrlsFromJsonPayload = (payload: string, pageUrl: string) => {
  try {
    const relatedUrls = new Set<string>();
    const visit = (value: unknown) => {
      if (!value) {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (typeof value !== "object") {
        return;
      }
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (key === "documentsSourceUrl" || key === "offerDigitalExternalPlatformUrl") {
          collectRelatedPageUrls(nested, pageUrl, relatedUrls);
        } else if (key === "documentsSourceNote") {
          collectRelatedPageUrls(nested, pageUrl, relatedUrls, true);
        } else {
          visit(nested);
        }
      }
    };
    visit(JSON.parse(payload));

    const self = resolvePageUrl(pageUrl, pageUrl);
    return [...relatedUrls].filter((url) => url !== self);
  } catch {
    return [];
  }
};

export { resolvePageUrl };
