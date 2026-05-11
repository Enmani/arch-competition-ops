export const satellitePreviewCacheVersion = 5;

export const sanitizeSatellitePreviewFileName = (slug: string) =>
  slug.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 180);

export const getSatellitePreviewStaticFileName = (slug: string) =>
  `${sanitizeSatellitePreviewFileName(slug)}_v${satellitePreviewCacheVersion}.jpg`;

export const getSatellitePreviewStaticAssetPath = (slug: string) =>
  `/opportunity-card-satellite/${getSatellitePreviewStaticFileName(slug)}`;
