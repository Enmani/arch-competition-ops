// The manifest is the contract between the offline generator and the Web image route. It is plain
// JSON, validated on read, and this module imports nothing from Node so the Worker can use it.
//
// Layout of a previews directory (artifacts/previews/, and apps/web/public/previews/ when published):
//   manifest.json
//   images/<file>.jpg

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";
export const IMAGES_DIRECTORY = "images";

/** `none`: nothing usable was found; remembered so the generator does not retry on every run. */
export type PreviewKind = "official-image" | "satellite" | "locator" | "none";

export type PreviewLocatorPoint = {
  label: string | null;
  lat: number;
  lng: number;
  precision: string;
};

export type PreviewManifestEntry = {
  algorithmVersion: string;
  /** Credit line that must accompany the image; also burned into satellite images. */
  attribution: string | null;
  /** Image file name inside `images/`, or null when only a locator (or nothing) was found. */
  file: string | null;
  generatedAt: string;
  kind: PreviewKind;
  /** Where the record is, for the placeholder marker when there is no image. */
  locator?: PreviewLocatorPoint;
  /** Hash of the record fields and algorithm version this entry was generated from. */
  sourceHash: string;
};

export type PreviewManifest = {
  entries: Record<string, PreviewManifestEntry>;
  generatedAt: string;
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
};

const kinds: ReadonlySet<string> = new Set(["official-image", "satellite", "locator", "none"]);

/** File names come from the manifest, so they are re-validated before they reach a path or URL. */
export const isSafeImageFileName = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.jpg$/.test(value) && !value.includes("..");

export const sanitizePreviewSlug = (slug: string) =>
  slug.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120);

export const buildPreviewFileName = (slug: string, sourceHash: string) =>
  `${sanitizePreviewSlug(slug)}-${sourceHash.slice(0, 10)}.jpg`;

export const createEmptyManifest = (now: Date = new Date()): PreviewManifest => ({
  entries: {},
  generatedAt: now.toISOString(),
  schemaVersion: MANIFEST_SCHEMA_VERSION,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseLocator = (value: unknown): PreviewLocatorPoint | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const { label, lat, lng, precision } = value;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    typeof precision !== "string"
  ) {
    return undefined;
  }
  return { label: typeof label === "string" ? label : null, lat, lng, precision };
};

const parseEntry = (value: unknown): PreviewManifestEntry | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { algorithmVersion, attribution, file, generatedAt, kind, sourceHash } = value;
  if (
    typeof algorithmVersion !== "string" ||
    typeof sourceHash !== "string" ||
    typeof generatedAt !== "string" ||
    typeof kind !== "string" ||
    !kinds.has(kind)
  ) {
    return null;
  }
  if (file !== null && (typeof file !== "string" || !isSafeImageFileName(file))) {
    return null;
  }
  const locator = parseLocator(value.locator);
  return {
    algorithmVersion,
    attribution: typeof attribution === "string" ? attribution : null,
    file,
    generatedAt,
    kind: kind as PreviewKind,
    ...(locator ? { locator } : {}),
    sourceHash,
  };
};

/** Returns null when the payload is not a manifest of this schema; drops individually bad entries. */
export const parsePreviewManifest = (input: unknown): PreviewManifest | null => {
  if (!isRecord(input) || input.schemaVersion !== MANIFEST_SCHEMA_VERSION || !isRecord(input.entries)) {
    return null;
  }
  const entries: Record<string, PreviewManifestEntry> = {};
  for (const [slug, raw] of Object.entries(input.entries)) {
    const entry = parseEntry(raw);
    if (entry) {
      entries[slug] = entry;
    }
  }
  return {
    entries,
    generatedAt: typeof input.generatedAt === "string" ? input.generatedAt : "",
    schemaVersion: MANIFEST_SCHEMA_VERSION,
  };
};
