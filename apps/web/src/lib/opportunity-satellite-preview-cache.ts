import { satellitePreviewRevision } from "./opportunity-preview-revision";

const revisionHashPattern = /_h[0-9a-f]{10}$/i;

export const sanitizeSatellitePreviewFileName = (slug: string) =>
  slug.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 180);

export const getSatellitePreviewStaticFileName = (slug: string) =>
  `${sanitizeSatellitePreviewFileName(slug)}_${satellitePreviewRevision}.jpg`;

const stripTrailingRevisionHash = (value: string) => value.replace(revisionHashPattern, "");

export const getSatellitePreviewStaticFileNameCandidates = (slug: string) => {
  const sanitizedSlug = sanitizeSatellitePreviewFileName(slug);
  const canonicalBaseName = stripTrailingRevisionHash(sanitizedSlug);
  const legacyVersionedCandidates = Array.from(
    { length: 6 },
    (_, index) => `${canonicalBaseName}_v${6 - index}.jpg`,
  );

  const candidateSet = new Set([
    `${sanitizedSlug}_${satellitePreviewRevision}.jpg`,
    `${canonicalBaseName}_${satellitePreviewRevision}.jpg`,
    sanitizedSlug === canonicalBaseName
      ? null
      : `${sanitizedSlug}.jpg`,
    ...legacyVersionedCandidates,
    `${canonicalBaseName}.jpg`,
  ]);

  return [...candidateSet].filter((candidate): candidate is string => candidate !== null);
};

export const getSatellitePreviewStaticAssetPath = (slug: string) =>
  `/opportunity-card-satellite/${getSatellitePreviewStaticFileName(slug)}`;

export const getSatellitePreviewStaticAssetPaths = (slug: string) =>
  getSatellitePreviewStaticFileNameCandidates(slug).map(
    (fileName) => `/opportunity-card-satellite/${fileName}`,
  );
