import { buildOpportunityLocatorPlaceholderSvg } from "@arch-competition/previews/placeholder";
import {
  lookupPreview,
  type ManifestLoader,
  type PreviewAssetSource,
} from "@arch-competition/previews/serve";

/**
 * The response logic of /api/opportunities/[slug]/image, free of any runtime binding so it can be
 * tested. The request path does two things only: look the record up in the prebuilt preview
 * manifest and return that asset, or draw the locator placeholder. Everything expensive
 * (geocoding, fetching notice pages and PDFs, map tiles, image processing) happens offline in
 * packages/previews. Nothing here fetches a third-party URL or this site's own domain.
 */
export type PreviewSource = { loader: ManifestLoader; source: PreviewAssetSource };

type PlaceholderOpportunity = NonNullable<Parameters<typeof buildOpportunityLocatorPlaceholderSvg>[0]>;

export type OpportunityImageDeps = {
  /** `next dev`: never cache, so a freshly generated preview shows up on reload. */
  development: boolean;
  getOpportunity: (slug: string) => Promise<PlaceholderOpportunity | null | undefined>;
  getPreviewSource: () => Promise<PreviewSource>;
  /** Current `?rev=` value (the preview algorithm version). */
  revision: string;
};

export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const ASSET_CACHE = "public, max-age=3600";
export const PLACEHOLDER_CACHE = "public, max-age=300";
export const MISSING_CACHE = "public, max-age=60";
const NO_STORE = "no-store, max-age=0";

export const createOpportunityImageHandler = (deps: OpportunityImageDeps) => {
  const cacheControl = (value: string) => (deps.development ? NO_STORE : value);

  const placeholder = (
    opportunity?: PlaceholderOpportunity,
    override?: Parameters<typeof buildOpportunityLocatorPlaceholderSvg>[1],
    status = 200,
  ) =>
    new Response(buildOpportunityLocatorPlaceholderSvg(opportunity, override), {
      headers: {
        "cache-control": cacheControl(status === 200 ? PLACEHOLDER_CACHE : MISSING_CACHE),
        "content-type": "image/svg+xml; charset=utf-8",
        "x-arch-image-source": "placeholder",
      },
      status,
    });

  return async (request: Request, slug: string): Promise<Response> => {
    const { loader, source } = await deps.getPreviewSource();
    const preview = await lookupPreview(loader, source, slug);

    if (preview?.image) {
      // Immutable only when the URL carries the current revision AND the asset was produced by
      // that algorithm version; a leftover image from an older version is served, but
      // revalidated within the hour.
      const versioned =
        new URL(request.url).searchParams.get("rev") === deps.revision &&
        preview.entry.algorithmVersion === deps.revision;
      return new Response(new Uint8Array(preview.image).buffer, {
        headers: {
          "cache-control": cacheControl(versioned ? IMMUTABLE_CACHE : ASSET_CACHE),
          "content-type": "image/jpeg",
          "x-arch-image-source": "asset",
        },
      });
    }

    const opportunity = await deps.getOpportunity(slug);
    if (!opportunity) {
      return placeholder(undefined, undefined, 404);
    }

    // The generator may know where the record is even though it could not render imagery.
    const locator = preview?.entry.locator;
    return placeholder(
      opportunity,
      locator
        ? { geoLat: locator.lat, geoLng: locator.lng, locationLabel: locator.label }
        : undefined,
    );
  };
};
