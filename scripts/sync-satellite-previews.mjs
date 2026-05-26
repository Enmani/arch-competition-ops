import { cp, mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeOpportunityPreviewRevisionModule } from "./lib/opportunity-preview-revision.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, "..");
const sourceDirectory = path.join(repoRoot, "artifacts", "opportunity-card-satellite", "images");
const targetDirectory = path.join(repoRoot, "apps", "web", "public", "opportunity-card-satellite");

const legacyVersionSuffixPattern = /_v\d+$/i;
const revisionHashSuffixPattern = /_h[0-9a-f]{10}$/i;
const imageExtensionPattern = /\.jpg$/i;
const { satellitePreviewRevision } = await writeOpportunityPreviewRevisionModule(repoRoot);

const getSatellitePreviewStaticFileName = (slug) =>
  `${slug.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 180)}_${satellitePreviewRevision}.jpg`;

const getCanonicalSatellitePreviewFileName = (fileName) => {
  const baseName = fileName.replace(imageExtensionPattern, "");
  const normalizedBaseName = baseName
    .replace(legacyVersionSuffixPattern, "")
    .replace(revisionHashSuffixPattern, "");
  return getSatellitePreviewStaticFileName(normalizedBaseName);
};

const getLegacyPreviewVersion = (fileName) => {
  const versionMatch = fileName.match(/_v(\d+)\.jpg$/i);
  if (versionMatch) {
    return Number(versionMatch[1]);
  }

  return 0;
};

const syncSatellitePreviews = async () => {
  await rm(targetDirectory, { force: true, recursive: true });
  await mkdir(targetDirectory, { recursive: true });

  let sourceEntries = [];
  try {
    sourceEntries = await readdir(sourceDirectory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      console.log("No local satellite preview cache found. Continuing with an empty static preview set.");
      return;
    }

    throw error;
  }

  const imageEntries = sourceEntries.filter(
    (entry) => entry.isFile() && imageExtensionPattern.test(entry.name),
  );
  const canonicalCopySources = new Map();

  imageEntries.forEach((entry) => {
    const canonicalFileName = getCanonicalSatellitePreviewFileName(entry.name);
    const previousEntry = canonicalCopySources.get(canonicalFileName);

    if (!previousEntry || getLegacyPreviewVersion(entry.name) > getLegacyPreviewVersion(previousEntry.name)) {
      canonicalCopySources.set(canonicalFileName, entry);
    }
  });

  const copyJobs = imageEntries.map(async (entry) => {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const legacyTargetPath = path.join(targetDirectory, entry.name);
    const canonicalFileName = getCanonicalSatellitePreviewFileName(entry.name);
    const canonicalTargetPath = path.join(targetDirectory, canonicalFileName);

    await cp(sourcePath, legacyTargetPath);

    if (
      canonicalTargetPath !== legacyTargetPath &&
      canonicalCopySources.get(canonicalFileName)?.name === entry.name
    ) {
      await cp(sourcePath, canonicalTargetPath);
    }
  });

  await Promise.all(copyJobs);
  console.log(
    `Synced ${copyJobs.length} satellite preview image(s) to ${path.relative(repoRoot, targetDirectory)}`,
  );
};

syncSatellitePreviews().catch((error) => {
  console.error("Failed to sync satellite previews.", error);
  process.exitCode = 1;
});
