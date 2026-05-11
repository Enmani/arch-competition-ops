import { resolveOpportunityCardImageUrl } from "@/lib/opportunity-card-image";
import { buildOpportunityLocatorPlaceholderSvg } from "@/lib/opportunity-card-placeholder";
import { getSatellitePreviewStaticAssetPath } from "@/lib/opportunity-satellite-preview-cache";
import {
  getWebOpportunityFeedItemBySlug,
  type StoredOpportunityFeedItem,
} from "@/lib/server-storage";

export const dynamic = "force-dynamic";

const stadtZurichHosts = ["stadt-zuerich.ch"];
const satellitePreviewContentType = "image/jpeg";

type SatellitePreviewModule = typeof import("@/lib/opportunity-satellite-preview");
type OpportunityImageSourceInput = Pick<
  StoredOpportunityFeedItem,
  "briefPdfUrl" | "documentsPortalUrl" | "officialUrl" | "sourceUrl"
>;

let satellitePreviewModulePromise: Promise<SatellitePreviewModule | null> | null = null;

const buildPlaceholderResponse = (opportunity?: StoredOpportunityFeedItem, status = 200) =>
  new Response(buildOpportunityLocatorPlaceholderSvg(opportunity), {
    status,
    headers: {
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-type": "image/svg+xml; charset=utf-8",
    },
  });

const fetchImageResponse = async (imageUrl: string) => {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.startsWith("image/")) {
      return null;
    }

    const payload = await response.arrayBuffer();
    return new Response(payload, {
      headers: {
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "content-type": contentType,
      },
    });
  } catch {
    return null;
  }
};

const fetchStaticSatellitePreviewResponse = async (request: Request, slug: string) => {
  try {
    const assetUrl = new URL(getSatellitePreviewStaticAssetPath(slug), request.url);
    const response = await fetch(assetUrl, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.startsWith("image/")) {
      return null;
    }

    const payload = await response.arrayBuffer();
    return new Response(payload, {
      headers: {
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "content-type": contentType,
      },
    });
  } catch {
    return null;
  }
};

const getHostname = (url: string | null | undefined) => {
  if (!url) {
    return "";
  }

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const hostMatches = (hostname: string, patterns: string[]) =>
  patterns.some((pattern) => hostname === pattern || hostname.endsWith(`.${pattern}`));

const isStadtZurichOpportunitySource = (opportunity: OpportunityImageSourceInput) =>
  [
    opportunity.officialUrl,
    opportunity.sourceUrl,
    opportunity.documentsPortalUrl,
    opportunity.briefPdfUrl,
  ].some((url) => hostMatches(getHostname(url), stadtZurichHosts));

const loadSatellitePreviewModule = () => {
  satellitePreviewModulePromise ??= import("@/lib/opportunity-satellite-preview")
    .then((module) => module)
    .catch(() => null);

  return satellitePreviewModulePromise;
};

const buildBinaryImageResponse = (
  payload: ArrayBuffer | Uint8Array<ArrayBufferLike>,
  contentType: string,
) => {
  const body =
    payload instanceof ArrayBuffer
      ? payload.slice(0)
      : Uint8Array.from(payload).buffer;

  return new Response(body, {
    headers: {
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-type": contentType,
    },
  });
};

type OpportunityImageRouteContext = {
  params: Promise<{ slug: string }>;
};

export const GET = async (
  request: Request,
  { params }: OpportunityImageRouteContext,
) => {
  const { slug } = await params;
  const opportunity = await getWebOpportunityFeedItemBySlug(slug);

  if (!opportunity) {
    return buildPlaceholderResponse(undefined, 404);
  }

  if (isStadtZurichOpportunitySource(opportunity)) {
    const imageUrl = await resolveOpportunityCardImageUrl(opportunity);
    if (imageUrl) {
      const imageResponse = await fetchImageResponse(imageUrl);
      if (imageResponse) {
        return imageResponse;
      }
    }
  }

  const staticSatellitePreviewResponse = await fetchStaticSatellitePreviewResponse(
    request,
    opportunity.slug,
  );
  if (staticSatellitePreviewResponse) {
    return staticSatellitePreviewResponse;
  }

  const satellitePreviewModule = await loadSatellitePreviewModule();
  if (satellitePreviewModule) {
    try {
      const satellitePreview =
        await satellitePreviewModule.resolveOpportunitySatellitePreview(opportunity);
      if (satellitePreview) {
        return buildBinaryImageResponse(satellitePreview, satellitePreviewContentType);
      }
    } catch {
      // Fall back to the placeholder if the runtime cannot load the satellite preview pipeline.
    }
  }

  return buildPlaceholderResponse(opportunity);
};
