// Filesystem source for `next dev` / `next start` on a machine that ran the generator. Node only;
// the Worker build never imports this file (the image route loads it dynamically).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { IMAGES_DIRECTORY, MANIFEST_FILE, isSafeImageFileName } from "../manifest";
import type { PreviewAssetSource } from "./index";

const isAllowedRelativePath = (relativePath: string) => {
  if (relativePath === MANIFEST_FILE) {
    return true;
  }
  const prefix = `${IMAGES_DIRECTORY}/`;
  return relativePath.startsWith(prefix) && isSafeImageFileName(relativePath.slice(prefix.length));
};

export const createFilesystemSource = (directory: () => string | null): PreviewAssetSource => {
  const read = async (relativePath: string) => {
    const root = directory();
    if (!root || !isAllowedRelativePath(relativePath)) {
      return null;
    }
    try {
      return await readFile(path.join(root, ...relativePath.split("/")));
    } catch {
      return null;
    }
  };
  return {
    readBinary: async (relativePath) => {
      const data = await read(relativePath);
      return data ? new Uint8Array(data) : null;
    },
    readText: async (relativePath) => (await read(relativePath))?.toString("utf8") ?? null,
  };
};

/**
 * Where a local previews directory lives, relative to wherever the Web process was started
 * (repo root or apps/web). `ARCH_PREVIEWS_DIR` wins; otherwise the generator output, then the
 * published copy under public/.
 */
export const resolveLocalPreviewsDirectory = (
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | null => {
  const candidates = [
    env.ARCH_PREVIEWS_DIR,
    path.resolve(cwd, "artifacts", "previews"),
    path.resolve(cwd, "..", "..", "artifacts", "previews"),
    path.resolve(cwd, "public", "previews"),
    path.resolve(cwd, "apps", "web", "public", "previews"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(path.join(candidate, MANIFEST_FILE))) ?? null;
};
