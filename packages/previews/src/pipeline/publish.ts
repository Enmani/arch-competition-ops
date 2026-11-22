import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { LOCATORS_DIRECTORY, MANIFEST_FILE, isSafeLocatorFileName, locatorInput, type PreviewManifest } from "../manifest";
import { buildOpportunityLocatorInsetSvg, buildOpportunityLocatorPlaceholderSvg } from "../placeholder/render";
import { PREVIEW_ALGORITHM_VERSION } from "../version";
import { readOpportunities } from "./db";
import { computeSourceHash, copyPreviewImages, fileExists, writeFileAtomic } from "./store";

export const publishPreviews = async (
  directory: string,
  publishDirectory: string,
  manifest: PreviewManifest,
  databasePath: string,
) => {
  const { available, copied } = await copyPreviewImages(directory, publishDirectory, manifest);
  const ids = Object.keys(manifest.entries);
  const opportunities = ids.length ? readOpportunities(databasePath, { only: ids }) : [];
  const locators = path.join(publishDirectory, LOCATORS_DIRECTORY);
  const wanted = new Set<string>();
  const writeLocator = async (svg: string) => {
    const file = `${createHash("sha256").update(svg).digest("hex").slice(0, 24)}.svg`;
    if (!wanted.has(file) && !(await fileExists(path.join(locators, file)))) {
      await writeFileAtomic(path.join(locators, file), svg);
    }
    wanted.add(file);
    return file;
  };
  const entries: PreviewManifest["entries"] = Object.fromEntries(ids.map((id) => {
    const { locatorAssets: _oldLocators, ...entry } = manifest.entries[id];
    return [id, { ...entry, file: entry.file && available.has(entry.file) ? entry.file : null }];
  }));
  for (const opportunity of opportunities) {
    const entry = entries[opportunity.slug];
    if (entry.algorithmVersion !== PREVIEW_ALGORITHM_VERSION || entry.sourceHash !== computeSourceHash(opportunity)) continue;
    const override = entry.locator && {
      geoLat: entry.locator.lat, geoLng: entry.locator.lng, locationLabel: entry.locator.label,
    };
    const locator = buildOpportunityLocatorPlaceholderSvg(opportunity, override);
    const inset = buildOpportunityLocatorInsetSvg(opportunity, override);
    entry.locatorAssets = {
      input: locatorInput(opportunity),
      locator: await writeLocator(locator),
      inset: inset ? await writeLocator(inset) : null,
    };
  }
  await writeFileAtomic(
    path.join(publishDirectory, MANIFEST_FILE),
    `${JSON.stringify({ ...manifest, entries }, null, 1)}\n`,
  );
  const files = await readdir(locators).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const file of files) {
    if (isSafeLocatorFileName(file) && !wanted.has(file)) await rm(path.join(locators, file), { force: true });
  }
  return copied;
};
