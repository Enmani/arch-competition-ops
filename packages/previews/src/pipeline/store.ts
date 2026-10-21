// Filesystem side of the generator: the previews directory, its manifest, the run lock and the
// optional copy into apps/web/public. Every write is tmp-file + rename, so a crash or a reader
// never sees a half-written manifest or image.
import { createHash, randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { PREVIEW_ALGORITHM_VERSION } from "../version";
import {
  IMAGES_DIRECTORY,
  MANIFEST_FILE,
  createEmptyManifest,
  isSafeImageFileName,
  parsePreviewManifest,
  type PreviewManifest,
} from "../manifest";
import type { PreviewOpportunity } from "../types";

export const computeSourceHash = (opportunity: PreviewOpportunity) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        PREVIEW_ALGORITHM_VERSION,
        opportunity.slug,
        opportunity.title,
        opportunity.authorityName,
        opportunity.jurisdictionKey,
        opportunity.locationLabel,
        opportunity.officialUrl,
        opportunity.sourceUrl,
        opportunity.documentsPortalUrl,
        opportunity.briefPdfUrl,
        opportunity.geoLat ?? null,
        opportunity.geoLng ?? null,
      ]),
    )
    .digest("hex")
    .slice(0, 16);

const temporaryName = (target: string) => `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;

export const writeFileAtomic = async (target: string, data: Buffer | string) => {
  const temporary = temporaryName(target);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(temporary, data);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const readManifest = async (directory: string): Promise<PreviewManifest> => {
  try {
    const parsed = parsePreviewManifest(
      JSON.parse(await readFile(path.join(directory, MANIFEST_FILE), "utf8")),
    );
    return parsed ?? createEmptyManifest();
  } catch {
    return createEmptyManifest();
  }
};

export const writeManifest = (directory: string, manifest: PreviewManifest) =>
  writeFileAtomic(
    path.join(directory, MANIFEST_FILE),
    `${JSON.stringify({ ...manifest, generatedAt: new Date().toISOString() }, null, 1)}\n`,
  );

export const imagePath = (directory: string, file: string) =>
  path.join(directory, IMAGES_DIRECTORY, file);

export const fileExists = async (target: string) => {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
};

export const listImageFiles = async (directory: string): Promise<string[]> => {
  try {
    return (await readdir(path.join(directory, IMAGES_DIRECTORY))).filter(isSafeImageFileName);
  } catch {
    return [];
  }
};

export class LockHeldError extends Error {
  constructor(readonly lockPath: string) {
    super(`another preview run holds ${lockPath}`);
    this.name = "LockHeldError";
  }
}

const STALE_LOCK_MS = 2 * 60 * 60 * 1000;

/** Single-writer lock for a previews directory. A lock older than two hours is considered dead. */
export const acquireLock = async (directory: string, now: () => number = Date.now) => {
  const lockPath = path.join(directory, ".lock");
  await mkdir(directory, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n${new Date(now()).toISOString()}\n`);
      await handle.close();
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const age = now() - (await stat(lockPath).catch(() => ({ mtimeMs: now() }))).mtimeMs;
      if (age < STALE_LOCK_MS) {
        throw new LockHeldError(lockPath);
      }
      await rm(lockPath, { force: true });
    }
  }
  throw new LockHeldError(lockPath);
};

/**
 * Mirror the manifest and the images it references into `publishDirectory` (apps/web/public/previews),
 * which the Web build ships as static assets. Unreferenced images there are removed so the shipped
 * set cannot grow without bound.
 */
export const publishPreviews = async (
  directory: string,
  publishDirectory: string,
  manifest: PreviewManifest,
) => {
  const wanted = new Set(
    Object.values(manifest.entries).flatMap((entry) => (entry.file ? [entry.file] : [])),
  );
  await mkdir(path.join(publishDirectory, IMAGES_DIRECTORY), { recursive: true });
  let copied = 0;
  for (const file of wanted) {
    const target = imagePath(publishDirectory, file);
    if (await fileExists(target)) {
      continue;
    }
    try {
      await copyFile(imagePath(directory, file), target);
      copied += 1;
    } catch {
      // The source image is missing; the manifest entry is dropped by the next prune.
    }
  }
  for (const file of await listImageFiles(publishDirectory)) {
    if (!wanted.has(file)) {
      await rm(imagePath(publishDirectory, file), { force: true });
    }
  }
  await writeFileAtomic(
    path.join(publishDirectory, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 1)}\n`,
  );
  return copied;
};
