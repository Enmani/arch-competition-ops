// Pick the most representative image on a notice page (og:image, JSON-LD, <img>, srcset ...).
//
// Only portals reachable through the live path keep tuned rules: the Stadt Zuerich site and the
// Konkurado documents portal that its notices link to. The Hamburg, attachment-only and
// "conservative placeholder" branches of the old module could never run (audit F8) and are gone.
import officialImageKeywords from "../../data/official-image-keywords.json";
import { getHostname, hostMatches } from "../documents/urls";
import { parseTagAttributes } from "../text/html";

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

const preferredImageKeywords: string[] = officialImageKeywords.preferred;
const blockedImageKeywords: string[] = officialImageKeywords.blocked;
const previewMetaNames = new Set<string>(officialImageKeywords.metaNames);

const minimumCandidateScore = 58;
const documentsPortalHosts = ["konkurado.ch"];
const swissAuthorityHosts = ["stadt-zuerich.ch"];
const blockedImageUrlPatterns = [
  /\/netserver\/_images\/img\//,
  /\/img\/browser\//,
  /\/img\/platforms\/[^?#]*32x32/i,
];

const baseScores: Record<ImageCandidateSource, number> = {
  img: 58,
  jsonld: 84,
  link: 76,
  meta: 92,
  source: 70,
  style: 62,
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

export const resolveImageUrl = (candidate: string | null | undefined, pageUrl: string) => {
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
      return { rawUrl: url, width: Number.isFinite(width) ? width : undefined };
    })
    .filter((entry) => entry.rawUrl);
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => (right.width ?? 0) - (left.width ?? 0));
  return candidates[0];
};

const extractStyleImageUrls = (style: string | null | undefined) => {
  const urls: string[] = [];
  for (const match of (style ?? "").matchAll(/url\((['"]?)(.*?)\1\)/gi)) {
    const candidate = match[2]?.trim();
    if (candidate) {
      urls.push(candidate);
    }
  }
  return urls;
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

  return score;
};

const scoreImageCandidate = (
  url: string,
  { descriptor, height, source, width }: ImageCandidateContext,
  pageUrl: string,
) => {
  const normalizedUrl = url.toLowerCase();
  const combined = `${normalizedUrl} ${descriptor.toLowerCase()}`;

  if (
    blockedImageUrlPatterns.some((pattern) => pattern.test(normalizedUrl)) ||
    hasBlockedKeyword(combined)
  ) {
    return null;
  }

  let score = baseScores[source];
  score += Math.min(24, countPreferredKeywordHits(combined) * 8);

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
  [...candidateMap.values()].sort((left, right) => right.score - left.score).at(0)?.url ?? null;

const collectJsonImageValues = (
  value: unknown,
  pageUrl: string,
  candidateMap: Map<string, ImageCandidate>,
) => {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    registerCandidate(candidateMap, value, pageUrl, { descriptor: "jsonld image", source: "jsonld" });
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
    if (!(key in record)) {
      continue;
    }
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
};

export const resolvePreviewImageUrlFromHtml = (html: string, pageUrl: string) => {
  const candidateMap = new Map<string, ImageCandidate>();

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const name = (attributes.property ?? attributes.name ?? attributes.itemprop ?? "").toLowerCase();
    if (previewMetaNames.has(name)) {
      registerCandidate(candidateMap, attributes.content, pageUrl, {
        descriptor: normalizeDescriptor("meta", name, attributes.content),
        source: "meta",
      });
    }
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const rel = (attributes.rel ?? "").toLowerCase();
    const as = (attributes.as ?? "").toLowerCase();
    if (rel.includes("image_src") || (rel.includes("preload") && as === "image")) {
      registerCandidate(candidateMap, attributes.href, pageUrl, {
        descriptor: normalizeDescriptor("link", rel, as, attributes.href),
        source: "link",
      });
    }
  }

  for (const match of html.matchAll(/<source\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const srcset = parseSrcsetCandidate(attributes.srcset ?? attributes["data-srcset"]);
    registerCandidate(candidateMap, srcset?.rawUrl, pageUrl, {
      descriptor: normalizeDescriptor("source", attributes.media, attributes.class, attributes.type),
      source: "source",
      width: srcset?.width,
    });
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const srcset = parseSrcsetCandidate(
      attributes["data-srcset"] ?? attributes["data-lazy-srcset"] ?? attributes.srcset,
    );
    const rawSource =
      srcset?.rawUrl ??
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
      width: srcset?.width ?? parseDimension(attributes.width),
    });
  }

  for (const match of html.matchAll(/<[a-zA-Z][^>]*\sstyle=(?:"[^"]*"|'[^']*')[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    for (const styleUrl of extractStyleImageUrls(attributes.style)) {
      registerCandidate(candidateMap, styleUrl, pageUrl, {
        descriptor: normalizeDescriptor("style", attributes.class, attributes.id, attributes.style),
        source: "style",
      });
    }
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

export const resolvePreviewImageUrlFromJson = (payload: string, pageUrl: string) => {
  try {
    const candidateMap = new Map<string, ImageCandidate>();
    collectJsonImageValues(JSON.parse(payload), pageUrl, candidateMap);
    return pickTopImageCandidate(candidateMap);
  } catch {
    return null;
  }
};
