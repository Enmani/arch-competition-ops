import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

type PreviewCacheEntry = {
  expiresAt: number;
  imageUrl: string | null;
};

type ImageCandidateSource = "jsonld" | "link" | "meta" | "img" | "source" | "style";

type ImageCandidate = {
  descriptor: string;
  score: number;
  source: ImageCandidateSource;
  url: string;
};

type ImageCandidateContext = {
  descriptor: string;
  height?: number;
  source: ImageCandidateSource;
  width?: number;
};

type SpecializedPreviewResolution = {
  handled: boolean;
  imageUrl: string | null;
};

const previewImageCache = new Map<string, PreviewCacheEntry>();
const cacheTtlMs = 1000 * 60 * 60 * 12;
const previewCacheVersion = "20260420e";
const minimumCandidateScore = 58;
const imageAttachmentPattern = /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
const imageAttachmentLabelPattern = /\b[^\s"'<>]+\.(?:avif|bmp|gif|jpe?g|png|webp)\b/i;
const attachmentOnlyHosts = [
  "acquistitelematici.it",
  "digitalpa.it",
  "maggiolicloud.it",
  "serviziocontrattipubblici.it",
];
const conservativePlaceholderHosts = [
  "ariba.com",
  "boamp.fr",
  "canadabuys.canada.ca",
  "contractsfinder.service.gov.uk",
  "doffin.no",
  "find-tender.service.gov.uk",
];
const documentsPortalHosts = ["konkurado.ch"];
const hamburgBuyerProfileHosts = ["hamburg.de"];
const simapHosts = ["simap.ch"];
const swissAuthorityHosts = ["stadt-zuerich.ch"];
const blockedImageUrlPatterns = [
  /\/netserver\/_images\/img\//,
  /\/img\/browser\//,
  /\/img\/platforms\/[^?#]*32x32/i,
];
const previewMetaNames = new Set([
  "image",
  "og:image",
  "og:image:secure_url",
  "og:image:url",
  "twitter:image",
  "twitter:image:src",
]);
const preferredImageKeywords = [
  "article",
  "content",
  "cover",
  "detail",
  "featured",
  "figure",
  "gallery",
  "header-image",
  "hero",
  "image",
  "lead",
  "main",
  "media",
  "photo",
  "picture",
  "preview",
  "project",
  "render",
  "stage",
  "teaser",
  "visual",
];
const blockedImageKeywords = [
  "apple-touch-icon",
  "avatar",
  "breadcrumb",
  "busy_indicator",
  "copyright",
  "crown",
  "default-avatar",
  "default-user",
  "favicon",
  "globe",
  "header-logo",
  "icon",
  "icon-sprite",
  "logo",
  "mstile",
  "ogl",
  "placeholder",
  "profile",
  "seal",
  "sidebar-logo",
  "sig-blk",
  "software-logo",
  "spinner",
  "sprite",
  "user",
  "user_no_sync",
  "wappen",
  "keyvis",
  "link_preview",
];

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const parseTagAttributes = (tag: string) => {
  const attributes: Record<string, string> = {};

  for (const match of tag.matchAll(
    /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )) {
    const [, rawName, doubleQuoted, singleQuoted, bareValue] = match;
    const rawValue = doubleQuoted ?? singleQuoted ?? bareValue ?? "";
    attributes[rawName.toLowerCase()] = decodeHtmlEntities(rawValue);
  }

  return attributes;
};

const parseDimension = (value: string | null | undefined) => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const normalizeDescriptor = (...values: Array<string | null | undefined>) =>
  values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

const hasBlockedKeyword = (value: string) =>
  blockedImageKeywords.some((keyword) => value.includes(keyword));

const countPreferredKeywordHits = (value: string) =>
  preferredImageKeywords.reduce((total, keyword) => total + (value.includes(keyword) ? 1 : 0), 0);

const getHostname = (pageUrl: string) => {
  try {
    return new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const hostMatches = (hostname: string, patterns: string[]) =>
  patterns.some((pattern) => hostname === pattern || hostname.endsWith(`.${pattern}`));

const resolveImageUrl = (candidate: string | null | undefined, pageUrl: string) => {
  if (!candidate) {
    return null;
  }

  try {
    const resolved = new URL(candidate, pageUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) {
      return null;
    }

    resolved.pathname = resolved.pathname.replace(/\/{2,}/g, "/");

    return resolved.toString();
  } catch {
    return null;
  }
};

const parseSrcsetCandidate = (srcset: string | null | undefined) => {
  if (!srcset) {
    return null;
  }

  const candidates = srcset
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, sizeHint] = entry.split(/\s+/, 2);
      const width = sizeHint?.endsWith("w") ? Number(sizeHint.slice(0, -1)) : undefined;
      return {
        rawUrl: url,
        width: Number.isFinite(width) ? width : undefined,
      };
    })
    .filter((entry) => entry.rawUrl);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => (right.width ?? 0) - (left.width ?? 0));
  return candidates[0];
};

const extractStyleImageUrls = (style: string | null | undefined) => {
  if (!style) {
    return [];
  }

  const urls: string[] = [];
  for (const match of style.matchAll(/url\((['"]?)(.*?)\1\)/gi)) {
    const candidate = match[2]?.trim();
    if (candidate) {
      urls.push(candidate);
    }
  }

  return urls;
};

const stripHtmlToText = (value: string) =>
  decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const resolvePageUrl = (candidate: string | null | undefined, pageUrl: string) => {
  if (!candidate) {
    return null;
  }

  const trimmedCandidate = candidate.trim();
  if (!trimmedCandidate) {
    return null;
  }

  const normalizedCandidate = /^www\./i.test(trimmedCandidate)
    ? `https://${trimmedCandidate}`
    : trimmedCandidate;

  return resolveImageUrl(normalizedCandidate, pageUrl);
};

const hasImageAttachmentLabel = (...values: Array<string | null | undefined>) =>
  values.some((value) => typeof value === "string" && imageAttachmentLabelPattern.test(value));

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

const findFirstPatternIndex = (html: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const index = html.search(pattern);
    if (index !== -1) {
      return index;
    }
  }

  return -1;
};

const sliceHtmlRegion = (html: string, startPatterns: RegExp[], endPatterns: RegExp[]) => {
  const startIndex = findFirstPatternIndex(html, startPatterns);
  const sliceStart = startIndex === -1 ? 0 : startIndex;
  const scopedHtml = html.slice(sliceStart);
  const endIndex = findFirstPatternIndex(scopedHtml, endPatterns);

  return endIndex === -1 ? scopedHtml : scopedHtml.slice(0, endIndex);
};

const baseScores: Record<ImageCandidateSource, number> = {
  jsonld: 84,
  link: 76,
  meta: 92,
  img: 58,
  source: 70,
  style: 62,
};

const scoreHostSpecificCandidateBonus = (url: string, pageUrl: string) => {
  const hostname = getHostname(pageUrl);
  const normalizedUrl = url.toLowerCase();
  let score = 0;

  if (hostMatches(hostname, documentsPortalHosts)) {
    if (/\/thumbs\/\d+x\d+\/competitions\//.test(normalizedUrl)) {
      score += 56;
    }
    if (/\/storage\/competitions\//.test(normalizedUrl)) {
      score -= 18;
    }
    if (/\/logo\//.test(normalizedUrl)) {
      score -= 32;
    }
  }

  if (hostMatches(hostname, swissAuthorityHosts)) {
    if (/(?:\/_jcr_content\/pageimage\b|\/bilder\/.+\/teaser\/)/.test(normalizedUrl)) {
      score += 18;
    }
    if (/\/corporate-design\//.test(normalizedUrl)) {
      score -= 36;
    }
  }

  if (hostMatches(hostname, hamburgBuyerProfileHosts) && /\/resource\/image\//.test(normalizedUrl)) {
    score -= 48;
  }

  return score;
};

const scoreImageCandidate = (
  url: string,
  { descriptor, height, source, width }: ImageCandidateContext,
  pageUrl: string,
) => {
  const normalizedUrl = url.toLowerCase();
  const normalizedDescriptor = descriptor.toLowerCase();
  const combined = `${normalizedUrl} ${normalizedDescriptor}`;

  if (
    blockedImageUrlPatterns.some((pattern) => pattern.test(normalizedUrl)) ||
    hasBlockedKeyword(combined)
  ) {
    return null;
  }

  let score = baseScores[source];
  const preferredHits = countPreferredKeywordHits(combined);
  score += Math.min(24, preferredHits * 8);

  if (normalizedUrl.endsWith(".svg")) {
    score -= 20;
  }
  if (normalizedUrl.endsWith(".gif")) {
    score -= 28;
  }
  if (/\bthumb|thumbnail|tiny|small|mini|xs|sm\b/.test(combined)) {
    score -= 18;
  }
  if (/landscape|ratio16x9|wide|hero|cover|teaser/.test(combined)) {
    score += 8;
  }
  if (/\/resource\/image\/|\/media\/|\/uploads?\//.test(normalizedUrl)) {
    score += 4;
  }

  score += scoreHostSpecificCandidateBonus(normalizedUrl, pageUrl);

  if (width !== undefined) {
    if (width >= 1200) score += 12;
    else if (width >= 800) score += 10;
    else if (width >= 400) score += 6;
    else if (width <= 160) score -= 30;
    else if (width <= 240) score -= 14;
  }

  if (height !== undefined) {
    if (height >= 400) score += 6;
    else if (height <= 160) score -= 18;
  }

  return score;
};

const registerCandidate = (
  candidateMap: Map<string, ImageCandidate>,
  rawUrl: string | null | undefined,
  pageUrl: string,
  context: ImageCandidateContext,
) => {
  const resolvedUrl = resolveImageUrl(rawUrl, pageUrl);
  if (!resolvedUrl) {
    return;
  }

  const score = scoreImageCandidate(resolvedUrl, context, pageUrl);
  if (score === null || score < minimumCandidateScore) {
    return;
  }

  const existing = candidateMap.get(resolvedUrl);
  if (!existing || score > existing.score) {
    candidateMap.set(resolvedUrl, {
      descriptor: context.descriptor,
      score,
      source: context.source,
      url: resolvedUrl,
    });
  }
};

const pickTopImageCandidate = (candidateMap: Map<string, ImageCandidate>) =>
  [...candidateMap.values()]
    .sort((left, right) => right.score - left.score)
    .at(0)?.url ?? null;

const resolveGenericPreviewImageUrlFromHtml = (html: string, pageUrl: string) => {
  const candidateMap = new Map<string, ImageCandidate>();

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const name = (attributes.property ?? attributes.name ?? attributes.itemprop ?? "").toLowerCase();
    if (!previewMetaNames.has(name)) {
      continue;
    }

    registerCandidate(candidateMap, attributes.content, pageUrl, {
      descriptor: normalizeDescriptor("meta", name, attributes.content),
      source: "meta",
    });
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const rel = (attributes.rel ?? "").toLowerCase();
    const as = (attributes.as ?? "").toLowerCase();
    if (!rel.includes("image_src") && !(rel.includes("preload") && as === "image")) {
      continue;
    }

    registerCandidate(candidateMap, attributes.href, pageUrl, {
      descriptor: normalizeDescriptor("link", rel, as, attributes.href),
      source: "link",
    });
  }

  for (const match of html.matchAll(/<source\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const srcsetCandidate = parseSrcsetCandidate(attributes.srcset ?? attributes["data-srcset"]);
    registerCandidate(candidateMap, srcsetCandidate?.rawUrl, pageUrl, {
      descriptor: normalizeDescriptor("source", attributes.media, attributes.class, attributes.type),
      source: "source",
      width: srcsetCandidate?.width,
    });
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const srcsetCandidate = parseSrcsetCandidate(
      attributes["data-srcset"] ??
        attributes["data-lazy-srcset"] ??
        attributes.srcset,
    );
    const rawSource =
      srcsetCandidate?.rawUrl ??
      attributes["data-lazy-src"] ??
      attributes["data-src"] ??
      attributes["data-original"] ??
      attributes["data-image"] ??
      attributes["data-file"] ??
      attributes.src;

    registerCandidate(candidateMap, rawSource, pageUrl, {
      descriptor: normalizeDescriptor(
        "img",
        attributes.alt,
        attributes.class,
        attributes.id,
        attributes["data-testid"],
      ),
      height: parseDimension(attributes.height),
      source: "img",
      width: srcsetCandidate?.width ?? parseDimension(attributes.width),
    });
  }

  for (const match of html.matchAll(/<[a-zA-Z][^>]*\sstyle=(?:"[^"]*"|'[^']*')[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const styleUrls = extractStyleImageUrls(attributes.style);
    styleUrls.forEach((styleUrl) => {
      registerCandidate(candidateMap, styleUrl, pageUrl, {
        descriptor: normalizeDescriptor("style", attributes.class, attributes.id, attributes.style),
        source: "style",
      });
    });
  }

  for (const match of html.matchAll(
    /<script\b[^>]*type=(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const payload = match[1]?.trim();
    if (!payload) {
      continue;
    }

    try {
      collectJsonImageValues(JSON.parse(payload), pageUrl, candidateMap);
    } catch {
      continue;
    }
  }

  return pickTopImageCandidate(candidateMap);
};

const resolveAttachmentFirstPreviewImageUrlFromHtml = (html: string, pageUrl: string) => {
  const candidateMap = new Map<string, ImageCandidate>();

  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const openingTag = match[0].match(/^<a\b[^>]*>/i)?.[0];
    if (!openingTag) {
      continue;
    }

    const attributes = parseTagAttributes(openingTag);
    const linkText = stripHtmlToText(match[1] ?? "");
    const attachmentCandidate =
      attributes.href ??
      attributes["data-href"] ??
      attributes["data-url"] ??
      attributes["data-file"];

    if (
      !attachmentCandidate ||
      (!imageAttachmentPattern.test(attachmentCandidate) &&
        !hasImageAttachmentLabel(
          attributes.download,
          attributes.title,
          attributes["aria-label"],
          attributes["data-filename"],
          linkText,
        ))
    ) {
      continue;
    }

    registerCandidate(candidateMap, attachmentCandidate, pageUrl, {
      descriptor: normalizeDescriptor(
        "attachment",
        attributes.download,
        attributes.class,
        attributes.title,
        attributes["aria-label"],
        attributes["data-filename"],
        linkText,
        attachmentCandidate,
      ),
      source: "link",
    });
  }

  return pickTopImageCandidate(candidateMap);
};

const resolveHamburgPreviewImageUrlFromHtml = (html: string, pageUrl: string) => {
  const scopedHtml = sliceHtmlRegion(
    html,
    [/class="km1-text-opener\b/i, /class="km1-article-intro\b/i],
    [/class="km1-teaser-row\b/i, /class="km1-sidebar\b/i],
  );

  return resolveGenericPreviewImageUrlFromHtml(scopedHtml, pageUrl);
};

const resolveSpecializedPreviewImageUrlFromHtml = (
  html: string,
  pageUrl: string,
): SpecializedPreviewResolution => {
  const hostname = getHostname(pageUrl);

  if (hostMatches(hostname, hamburgBuyerProfileHosts)) {
    return {
      handled: true,
      imageUrl: resolveHamburgPreviewImageUrlFromHtml(html, pageUrl),
    };
  }

  if (hostMatches(hostname, attachmentOnlyHosts)) {
    return {
      handled: true,
      imageUrl: resolveAttachmentFirstPreviewImageUrlFromHtml(html, pageUrl),
    };
  }

  if (hostMatches(hostname, conservativePlaceholderHosts)) {
    return {
      handled: true,
      imageUrl: null,
    };
  }

  return {
    handled: false,
    imageUrl: null,
  };
};

const collectJsonImageValues = (
  value: unknown,
  pageUrl: string,
  candidateMap: Map<string, ImageCandidate>,
) => {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    registerCandidate(candidateMap, value, pageUrl, {
      descriptor: "jsonld image",
      source: "jsonld",
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonImageValues(entry, pageUrl, candidateMap));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const width = parseDimension(String(record.width ?? ""));
  const height = parseDimension(String(record.height ?? ""));
  const descriptor = normalizeDescriptor(
    "jsonld",
    typeof record.caption === "string" ? record.caption : undefined,
    typeof record.description === "string" ? record.description : undefined,
    typeof record.name === "string" ? record.name : undefined,
  );

  for (const key of ["contentUrl", "image", "primaryImageOfPage", "thumbnail", "thumbnailUrl", "url"]) {
    if (key in record) {
      const candidateValue = record[key];
      if (typeof candidateValue === "string") {
        registerCandidate(candidateMap, candidateValue, pageUrl, {
          descriptor,
          height,
          source: "jsonld",
          width,
        });
      } else {
        collectJsonImageValues(candidateValue, pageUrl, candidateMap);
      }
    }
  }
};

export const resolvePreviewImageUrlFromHtml = (html: string, pageUrl: string) => {
  const specializedResolution = resolveSpecializedPreviewImageUrlFromHtml(html, pageUrl);
  if (specializedResolution.handled) {
    return specializedResolution.imageUrl;
  }

  return resolveGenericPreviewImageUrlFromHtml(html, pageUrl);
};

const resolvePreviewImageUrlFromJson = (payload: string, pageUrl: string) => {
  try {
    const candidateMap = new Map<string, ImageCandidate>();
    collectJsonImageValues(JSON.parse(payload), pageUrl, candidateMap);

    return [...candidateMap.values()]
      .sort((left, right) => right.score - left.score)
      .at(0)?.url ?? null;
  } catch {
    return null;
  }
};

const collectRelatedPreviewPageUrlsFromValue = (
  value: unknown,
  pageUrl: string,
  target: Set<string>,
  extractBareUrls = false,
) => {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    const candidates = extractBareUrls ? extractUrlsFromText(value) : [value];
    candidates.forEach((candidate) => {
      const resolvedUrl = resolvePageUrl(candidate, pageUrl);
      if (resolvedUrl) {
        target.add(resolvedUrl);
      }
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) =>
      collectRelatedPreviewPageUrlsFromValue(entry, pageUrl, target, extractBareUrls),
    );
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  Object.values(value as Record<string, unknown>).forEach((entry) =>
    collectRelatedPreviewPageUrlsFromValue(entry, pageUrl, target, extractBareUrls),
  );
};

export const extractRelatedPreviewPageUrlsFromJsonPayload = (payload: string, pageUrl: string) => {
  try {
    const parsed = JSON.parse(payload);
    const relatedUrls = new Set<string>();

    const visitRecord = (value: unknown) => {
      if (!value) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(visitRecord);
        return;
      }

      if (typeof value !== "object") {
        return;
      }

      Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
        if (key === "documentsSourceUrl" || key === "offerDigitalExternalPlatformUrl") {
          collectRelatedPreviewPageUrlsFromValue(nestedValue, pageUrl, relatedUrls);
          return;
        }

        if (key === "documentsSourceNote") {
          collectRelatedPreviewPageUrlsFromValue(nestedValue, pageUrl, relatedUrls, true);
          return;
        }

        visitRecord(nestedValue);
      });
    };

    visitRecord(parsed);

    const resolvedPageUrl = resolvePageUrl(pageUrl, pageUrl);
    return [...relatedUrls].filter((relatedUrl) => relatedUrl !== resolvedPageUrl);
  } catch {
    return [];
  }
};

const fetchPreviewImageUrl = async (
  pageUrl: string,
  visitedUrls = new Set<string>(),
): Promise<string | null> => {
  const normalizedPageUrl = resolvePageUrl(pageUrl, pageUrl) ?? pageUrl;
  if (visitedUrls.has(normalizedPageUrl)) {
    return null;
  }
  visitedUrls.add(normalizedPageUrl);

  const cacheKey = `${previewCacheVersion}:${normalizedPageUrl}`;
  const cached = previewImageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.imageUrl;
  }

  let imageUrl: string | null = null;
  let relatedPreviewPageUrls: string[] = [];

  try {
    const response = await fetch(normalizedPageUrl, {
      headers: {
        "accept-language": "en-US,en;q=0.9",
        accept: "text/html,application/xhtml+xml,application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(6500),
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (response.ok && (contentType.includes("text/html") || contentType.includes("application/json"))) {
      const payload = await response.text();
      if (contentType.includes("application/json")) {
        imageUrl = resolvePreviewImageUrlFromJson(payload, response.url);
        if (!imageUrl && hostMatches(getHostname(response.url), simapHosts)) {
          relatedPreviewPageUrls = extractRelatedPreviewPageUrlsFromJsonPayload(payload, response.url);
        }
      } else {
        imageUrl = resolvePreviewImageUrlFromHtml(payload, response.url);
      }
    }
  } catch {
    imageUrl = null;
  }

  if (!imageUrl) {
    for (const relatedPageUrl of relatedPreviewPageUrls) {
      imageUrl = await fetchPreviewImageUrl(relatedPageUrl, visitedUrls);
      if (imageUrl) {
        break;
      }
    }
  }

  previewImageCache.set(cacheKey, {
    expiresAt: Date.now() + cacheTtlMs,
    imageUrl,
  });

  return imageUrl;
};

export const resolveOpportunityCardImageUrl = async (
  opportunity: Pick<
    StoredOpportunityFeedItem,
    "briefPdfUrl" | "documentsPortalUrl" | "officialUrl" | "sourceUrl"
  >,
) => {
  const visitedUrls = new Set<string>();
  const candidatePages = [
    opportunity.documentsPortalUrl,
    opportunity.officialUrl,
    opportunity.sourceUrl,
    opportunity.briefPdfUrl,
  ].filter((pageUrl): pageUrl is string => typeof pageUrl === "string" && pageUrl.length > 0);

  for (const pageUrl of [...new Set(candidatePages)]) {
    const imageUrl = await fetchPreviewImageUrl(pageUrl, visitedUrls);
    if (imageUrl) {
      return imageUrl;
    }
  }

  return null;
};
