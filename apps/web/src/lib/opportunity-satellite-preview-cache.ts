import { satellitePreviewRevision } from "./opportunity-preview-revision";

export const sanitizeSatellitePreviewFileName = (slug: string) =>
  slug.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 180);

export const getSatellitePreviewStaticFileName = (slug: string) =>
  `${sanitizeSatellitePreviewFileName(slug)}_${satellitePreviewRevision}.jpg`;

export const getSatellitePreviewStaticFileNameCandidates = (slug: string) => {
  const sanitizedSlug = sanitizeSatellitePreviewFileName(slug);
  const legacyVersionedCandidates = Array.from(
    { length: 6 },
    (_, index) => `${sanitizedSlug}_v${6 - index}.jpg`,
  );

  return [
    `${sanitizedSlug}_${satellitePreviewRevision}.jpg`,
    ...legacyVersionedCandidates,
    `${sanitizedSlug}.jpg`,
  ];
};

export const getSatellitePreviewStaticAssetPath = (slug: string) =>
  `/opportunity-card-satellite/${getSatellitePreviewStaticFileName(slug)}`;

export const getSatellitePreviewStaticAssetPaths = (slug: string) =>
  getSatellitePreviewStaticFileNameCandidates(slug).map(
    (fileName) => `/opportunity-card-satellite/${fileName}`,
  );
