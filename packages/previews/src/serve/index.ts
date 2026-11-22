// Request-path lookup of prebuilt previews. Safe for Cloudflare Workers: no Node imports, no
// network other than the asset source handed in, no image processing. Whatever is not already in
// the manifest simply is not there; the caller answers with the locator placeholder instead.
import {
  IMAGES_DIRECTORY,
  LOCATORS_DIRECTORY,
  locatorInput,
  previewSourceInput,
  MANIFEST_FILE,
  isSafeImageFileName,
  parsePreviewManifest,
  type PreviewManifest,
  type PreviewManifestEntry,
} from "../manifest";

import type { OpportunityPlaceholderInput } from "../placeholder/render";
import type { PreviewOpportunity } from "../types";
import { PREVIEW_ALGORITHM_VERSION } from "../version";

export type StaticOpportunityPreview = {
  attribution: string | null;
  image: string | null;
  inset: string | null;
  locator: string;
};

const sourceEncoder = new TextEncoder();

export const staticOpportunityPreview = async (
  manifest: PreviewManifest,
  opportunity: PreviewOpportunity,
): Promise<StaticOpportunityPreview | undefined> => {
  const entry = Object.hasOwn(manifest.entries, opportunity.slug) ? manifest.entries[opportunity.slug] : undefined;
  const assets = entry?.locatorAssets;
  if (!assets || entry.algorithmVersion !== PREVIEW_ALGORITHM_VERSION || assets.input !== locatorInput(opportunity)) return;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", sourceEncoder.encode(previewSourceInput(opportunity))));
  const sourceHash = Array.from(hash.subarray(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (entry.sourceHash !== sourceHash) return;

  return {
    attribution: entry.attribution,
    image: entry.file ? `/previews/${IMAGES_DIRECTORY}/${entry.file}` : null,
    inset: assets.inset ? `/previews/${LOCATORS_DIRECTORY}/${assets.inset}` : null,
    locator: `/previews/${LOCATORS_DIRECTORY}/${assets.locator}`,
  };
};

export const previewLocatorOverride = (
  entry: PreviewManifestEntry | undefined,
  opportunity: OpportunityPlaceholderInput,
  revision: string,
) => {
  const point = entry?.locator;
  if (!point) return undefined;
  if (entry.locatorAssets && (entry.algorithmVersion !== revision || entry.locatorAssets.input !== locatorInput(opportunity))) {
    return undefined;
  }
  return { geoLat: point.lat, geoLng: point.lng, locationLabel: point.label };
};

/** Reads files of a previews directory by relative path ("manifest.json", "images/x.jpg"). */
export type PreviewAssetSource = {
  readBinary: (relativePath: string) => Promise<Uint8Array | null>;
  readText: (relativePath: string) => Promise<string | null>;
};

export type AssetsBinding = { fetch: (request: Request) => Promise<Response> };

/**
 * Source backed by the Workers static-assets binding (`env.ASSETS`). The binding routes by path
 * only, so the host is a placeholder; nothing goes over the public network.
 */
export const createAssetsBindingSource = (
  binding: AssetsBinding,
  basePath = "/previews/",
): PreviewAssetSource => {
  const load = async (relativePath: string) => {
    try {
      const response = await binding.fetch(
        new Request(new URL(`${basePath}${relativePath}`, "https://assets.invalid")),
      );
      return response.status === 200 ? response : null;
    } catch {
      return null;
    }
  };
  return {
    readBinary: async (relativePath) => {
      const response = await load(relativePath);
      return response ? new Uint8Array(await response.arrayBuffer()) : null;
    },
    readText: async (relativePath) => (await load(relativePath))?.text() ?? null,
  };
};

export type ManifestLoader = () => Promise<PreviewManifest | null>;

/** Memoises the parsed manifest for `ttlMs`; a failed read is cached briefly too. */
export const createManifestLoader = (
  source: PreviewAssetSource,
  { now = Date.now, ttlMs = 60_000 }: { now?: () => number; ttlMs?: number } = {},
): ManifestLoader => {
  let cached: { expiresAt: number; manifest: PreviewManifest | null } | null = null;
  let pending: Promise<PreviewManifest | null> | null = null;
  return async () => {
    if (cached && cached.expiresAt > now()) {
      return cached.manifest;
    }
    pending ??= (async () => {
      let manifest: PreviewManifest | null = null;
      try {
        const text = await source.readText(MANIFEST_FILE);
        manifest = text ? parsePreviewManifest(JSON.parse(text)) : null;
      } catch {
        manifest = null;
      }
      cached = { expiresAt: now() + (manifest ? ttlMs : Math.min(ttlMs, 10_000)), manifest };
      pending = null;
      return manifest;
    })();
    return pending;
  };
};

export type PreviewLookup = {
  entry: PreviewManifestEntry;
  /** JPEG bytes when the entry has an image that could be read. */
  image: Uint8Array | null;
};

const slugCandidates = (slug: string) => {
  try {
    const decoded = decodeURIComponent(slug);
    return decoded === slug ? [slug] : [slug, decoded];
  } catch {
    return [slug];
  }
};

export const lookupPreview = async (
  loader: ManifestLoader,
  source: PreviewAssetSource,
  slug: string,
  readImage = true,
): Promise<PreviewLookup | null> => {
  const manifest = await loader();
  if (!manifest) {
    return null;
  }
  for (const candidate of slugCandidates(slug)) {
    const entry = Object.hasOwn(manifest.entries, candidate) ? manifest.entries[candidate] : undefined;
    if (!entry) {
      continue;
    }
    if (!readImage || !entry.file || !isSafeImageFileName(entry.file)) {
      return { entry, image: null };
    }
    return { entry, image: await source.readBinary(`${IMAGES_DIRECTORY}/${entry.file}`) };
  }
  return null;
};
