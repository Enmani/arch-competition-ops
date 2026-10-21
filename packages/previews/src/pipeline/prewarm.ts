// The batch job: decide per opportunity whether its preview is current, generate what is not, and
// keep the manifest and image directory consistent. Everything slow or networked lives here, never
// in the Web request path.
import { rm } from "node:fs/promises";
import path from "node:path";

import { fetchOfficialCardImage } from "../official-image/resolve";
import {
  buildPreviewFileName,
  type PreviewManifest,
  type PreviewManifestEntry,
} from "../manifest";
import type { PreviewOpportunity } from "../types";
import { PREVIEW_ALGORITHM_VERSION } from "../version";
import { createRecordContext, type PipelineServices } from "./context";
import { readOpportunities } from "./db";
import { resolveOpportunitySatellite } from "./resolve-record";
import {
  acquireLock,
  computeSourceHash,
  fileExists,
  imagePath,
  listImageFiles,
  publishPreviews,
  readManifest,
  writeFileAtomic,
  writeManifest,
} from "./store";

export type PrewarmOptions = {
  databasePath: string;
  force?: boolean;
  limit?: number;
  now?: () => Date;
  only?: string[];
  outputDirectory: string;
  /** Drop manifest entries and images for records that are no longer visible. */
  prune?: boolean;
  publishDirectory?: string;
  /** Days before a record with no usable preview is tried again. */
  retryNoneDays?: number;
};

export type PrewarmSummary = {
  attempted: number;
  failed: number;
  generated: number;
  published?: number;
  skipped: number;
};

type Generated = {
  attribution: string | null;
  image: Buffer | null;
  kind: PreviewManifestEntry["kind"];
  locator?: PreviewManifestEntry["locator"];
};

const DAY_MS = 86_400_000;
const MANIFEST_CHECKPOINT_EVERY = 20;

export const generatePreview = async (
  services: PipelineServices,
  opportunity: PreviewOpportunity,
): Promise<Generated> => {
  const context = createRecordContext(services);
  const documents = { budget: context.budget, fetcher: context.documentFetcher };

  const official = await fetchOfficialCardImage(documents, opportunity);
  if (official) {
    return { attribution: official.attribution, image: official.image, kind: "official-image" };
  }

  const { image, locator } = await resolveOpportunitySatellite(context, opportunity);
  const locatorPoint = locator
    ? { label: locator.label, lat: locator.lat, lng: locator.lng, precision: locator.precision }
    : undefined;
  if (image) {
    return {
      attribution: services.config.tileAttribution,
      image,
      kind: "satellite",
      locator: locatorPoint,
    };
  }
  return locatorPoint
    ? { attribution: null, image: null, kind: "locator", locator: locatorPoint }
    : { attribution: null, image: null, kind: "none" };
};

const isCurrent = async (
  entry: PreviewManifestEntry | undefined,
  sourceHash: string,
  directory: string,
  retryNoneDays: number,
  nowMs: number,
) => {
  if (!entry || entry.algorithmVersion !== PREVIEW_ALGORITHM_VERSION || entry.sourceHash !== sourceHash) {
    return false;
  }
  if (entry.file && !(await fileExists(imagePath(directory, entry.file)))) {
    return false;
  }
  if (entry.kind === "none" || entry.kind === "locator") {
    // Worth another try after a while: a page may have been fixed, a rate limit may have passed.
    return nowMs - Date.parse(entry.generatedAt) < retryNoneDays * DAY_MS;
  }
  return true;
};

export const runPrewarm = async (
  services: PipelineServices,
  options: PrewarmOptions,
): Promise<PrewarmSummary> => {
  const now = options.now ?? (() => new Date());
  const directory = options.outputDirectory;
  const release = await acquireLock(directory);
  const summary: PrewarmSummary = { attempted: 0, failed: 0, generated: 0, skipped: 0 };

  try {
    const manifest: PreviewManifest = await readManifest(directory);
    const opportunities = readOpportunities(options.databasePath, {
      limit: options.limit,
      only: options.only,
    });
    await services.geocoding.cache.load();
    let sinceCheckpoint = 0;

    for (const opportunity of opportunities) {
      summary.attempted += 1;
      const sourceHash = computeSourceHash(opportunity);
      const previous = manifest.entries[opportunity.slug];
      if (
        !options.force &&
        (await isCurrent(previous, sourceHash, directory, options.retryNoneDays ?? 7, now().getTime()))
      ) {
        summary.skipped += 1;
        continue;
      }

      try {
        const result = await generatePreview(services, opportunity);
        const file = result.image ? buildPreviewFileName(opportunity.slug, sourceHash) : null;
        if (file && result.image) {
          await writeFileAtomic(imagePath(directory, file), result.image);
        }
        manifest.entries[opportunity.slug] = {
          algorithmVersion: PREVIEW_ALGORITHM_VERSION,
          attribution: result.attribution,
          file,
          generatedAt: now().toISOString(),
          kind: result.kind,
          ...(result.locator ? { locator: result.locator } : {}),
          sourceHash,
        };
        if (previous?.file && previous.file !== file) {
          await rm(imagePath(directory, previous.file), { force: true });
        }
        if (result.kind === "none") {
          summary.skipped += 1;
        } else {
          summary.generated += 1;
        }
      } catch (error) {
        summary.failed += 1;
        services.log("record-failed", {
          error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
          slug: opportunity.slug,
        });
      }

      sinceCheckpoint += 1;
      if (sinceCheckpoint >= MANIFEST_CHECKPOINT_EVERY) {
        sinceCheckpoint = 0;
        await writeManifest(directory, manifest);
        await services.geocoding.cache.flush();
      }
    }

    // A full pass sees every visible record, so anything else is stale and can go.
    if (options.prune && !options.only && !options.limit) {
      const visible = new Set(opportunities.map((opportunity) => opportunity.slug));
      for (const slug of Object.keys(manifest.entries)) {
        if (!visible.has(slug)) {
          delete manifest.entries[slug];
        }
      }
      const referenced = new Set(
        Object.values(manifest.entries).flatMap((entry) => (entry.file ? [entry.file] : [])),
      );
      for (const file of await listImageFiles(directory)) {
        if (!referenced.has(file)) {
          await rm(path.join(directory, "images", file), { force: true });
        }
      }
    }

    await services.geocoding.cache.flush();
    await writeManifest(directory, manifest);
    if (options.publishDirectory) {
      summary.published = await publishPreviews(directory, options.publishDirectory, manifest);
    }
    return summary;
  } finally {
    await release();
  }
};
