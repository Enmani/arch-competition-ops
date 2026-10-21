import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  createAssetsBindingSource,
  createManifestLoader,
  type AssetsBinding,
  type PreviewAssetSource,
} from "@arch-competition/previews/serve";

import { createOpportunityImageHandler, type PreviewSource } from "@/lib/opportunity-image-response";
import { opportunityImageRevision } from "@/lib/opportunity-preview-revision";
import { getWebOpportunityFeedItemBySlug } from "@/lib/server-storage";

/**
 * Card image for an opportunity: a prebuilt asset from the preview manifest, else the locator
 * placeholder. Generation is offline (`npm run prewarm:previews`); see opportunity-image-response.
 */
export const dynamic = "force-dynamic";

const development = process.env.NODE_ENV === "development";

const assetSources = new WeakMap<object, PreviewSource>();
let filesystemSource: Promise<PreviewSource> | null = null;

const forSource = (source: PreviewAssetSource): PreviewSource => ({
  loader: createManifestLoader(source),
  source,
});

/** Workers: the static-assets binding. `next dev` / `next start`: the local previews directory. */
const getPreviewSource = async (): Promise<PreviewSource> => {
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

const handle = createOpportunityImageHandler({
  development,
  getOpportunity: getWebOpportunityFeedItemBySlug,
  getPreviewSource,
  revision: opportunityImageRevision,
});

type OpportunityImageRouteContext = {
  params: Promise<{ slug: string }>;
};

export const GET = async (request: Request, { params }: OpportunityImageRouteContext) =>
  handle(request, (await params).slug);
