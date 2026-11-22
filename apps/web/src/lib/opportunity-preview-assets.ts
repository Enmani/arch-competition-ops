import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  createAssetsBindingSource,
  createManifestLoader,
  staticOpportunityPreview,
  type AssetsBinding,
  type PreviewAssetSource,
  type StaticOpportunityPreview,
} from "@arch-competition/previews/serve";
import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import type { PreviewSource } from "./opportunity-image-response";

export type OpportunityWithPreview = StoredOpportunityFeedItem & { preview?: StaticOpportunityPreview };

const development = process.env.NODE_ENV === "development";
const assetSources = new WeakMap<object, PreviewSource>();
let filesystemSource: Promise<PreviewSource> | null = null;

const forSource = (source: PreviewAssetSource): PreviewSource => ({
  loader: createManifestLoader(source),
  source,
});

/** Workers: the static-assets binding. `next dev` / `next start`: the local previews directory. */
export const getPreviewSource = async (): Promise<PreviewSource> => {
  if (!development) {
    try {
      const binding = (getCloudflareContext().env as { ASSETS?: AssetsBinding }).ASSETS;
      if (binding) {
        let resolved = assetSources.get(binding);
        if (!resolved) {
          resolved = forSource(createAssetsBindingSource(binding));
          assetSources.set(binding, resolved);
        }
        return resolved;
      }
    } catch {
      // Not running on Workers: fall through to the filesystem.
    }
  }

  filesystemSource ??= import("@arch-competition/previews/serve/fs").then(
    ({ createFilesystemSource, resolveLocalPreviewsDirectory }) =>
      forSource(createFilesystemSource(() => resolveLocalPreviewsDirectory())),
  );
  return filesystemSource;
};

/** Resolve matching files before the browser paints or appends cards, with no additional SQL. */
export const withOpportunityPreviews = async (
  opportunities: readonly StoredOpportunityFeedItem[],
): Promise<OpportunityWithPreview[]> => {
  if (!opportunities.length) return [];
  const { loader } = await getPreviewSource();
  const manifest = await loader();
  if (!manifest) return [...opportunities];
  return Promise.all(opportunities.map(async (opportunity) => {
    const preview = await staticOpportunityPreview(manifest, opportunity);
    return preview ? { ...opportunity, preview } : opportunity;
  }));
};
