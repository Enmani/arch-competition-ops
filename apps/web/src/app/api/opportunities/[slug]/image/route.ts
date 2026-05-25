import { resolveOpportunityCardImageUrl } from "@/lib/opportunity-card-image";
import { buildOpportunityLocatorPlaceholderSvg } from "@/lib/opportunity-card-placeholder";
import { getSatellitePreviewStaticAssetPaths } from "@/lib/opportunity-satellite-preview-cache";
import { isInvalidSatellitePreviewBuffer } from "@/lib/opportunity-satellite-preview-quality";
import {
  getWebOpportunityFeedItemBySlug,
  type StoredOpportunityFeedItem,
} from "@/lib/server-storage";

export const dynamic = "force-dynamic";

const responseCacheControl =
  process.env.NODE_ENV === "development"
    ? "no-store, max-age=0"
    : "public, max-age=3600, stale-while-revalidate=86400";
const satelliteRouteDebugEnabled = process.env.ARCH_SATELLITE_DEBUG === "1";

const stadtZurichHosts = ["stadt-zuerich.ch"];
const satellitePreviewContentType = "image/jpeg";

type SatellitePreviewModule = typeof import("@/lib/opportunity-satellite-preview");
type SatellitePreviewModuleShape = SatellitePreviewModule & {
  default?: Partial<SatellitePreviewModule>;
};
type OpportunityImageSourceInput = Pick<
  StoredOpportunityFeedItem,
  "briefPdfUrl" | "documentsPortalUrl" | "officialUrl" | "sourceUrl"
>;

let satellitePreviewModulePromise: Promise<SatellitePreviewModule | null> | null = null;

const debugSatelliteRoute = (...values: unknown[]) => {
  if (!satelliteRouteDebugEnabled) {
    return;
  }

  console.log("[satellite-route]", ...values);
};

const buildPlaceholderResponse = (opportunity?: StoredOpportunityFeedItem, status = 200) =>
  new Response(buildOpportunityLocatorPlaceholderSvg(opportunity), {
    status,
    headers: {
      "cache-control": responseCacheControl,
      "content-type": "image/svg+xml; charset=utf-8",
    },
  });

const buildGeocodedPlaceholderResponse = (
  opportunity: StoredOpportunityFeedItem,
  geocoded: { lat: number; lng: number; locationLabel: string | null },
) =>
  new Response(
    buildOpportunityLocatorPlaceholderSvg(opportunity, {
      geoLat: geocoded.lat,
      geoLng: geocoded.lng,
      locationLabel: geocoded.locationLabel,
    }),
    {
      headers: {
        "cache-control": responseCacheControl,
        "content-type": "image/svg+xml; charset=utf-8",
      },
    },
  );

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
        "cache-control": responseCacheControl,
        "content-type": contentType,
      },
    });
  } catch {
    return null;
  }
};

const fetchStaticSatellitePreviewResponse = async (request: Request, slug: string) => {
  for (const assetPath of getSatellitePreviewStaticAssetPaths(slug)) {
    try {
      const assetUrl = new URL(assetPath, request.url);
      const response = await fetch(assetUrl, {
        headers: {
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(4000),
      });

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!response.ok || !contentType.startsWith("image/")) {
        continue;
      }

      const payload = await response.arrayBuffer();
      const payloadBuffer = Buffer.from(payload);
      if (await isInvalidSatellitePreviewBuffer(payloadBuffer)) {
        continue;
      }

      return new Response(payload, {
        headers: {
          "cache-control": responseCacheControl,
          "content-type": contentType,
        },
      });
    } catch {
      continue;
    }
  }

  return null;
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
    .then((module) => {
      debugSatelliteRoute("module-loaded", Object.keys(module));
      return module;
    })
    .catch((error) => {
      debugSatelliteRoute("module-load-failed", error instanceof Error ? error.message : String(error));
      return null;
    });

  return satellitePreviewModulePromise;
};

const resolveSatellitePreviewModuleExport = (
  satellitePreviewModule: SatellitePreviewModule | null,
) => {
  if (!satellitePreviewModule) {
    return null;
  }

  const normalizedModule = satellitePreviewModule as SatellitePreviewModuleShape;
  return (
    normalizedModule.resolveOpportunitySatellitePreview ??
    normalizedModule.default?.resolveOpportunitySatellitePreview ??
    null
  );
};

const resolveSatelliteLocatorModuleExport = (
  satellitePreviewModule: SatellitePreviewModule | null,
) => {
  if (!satellitePreviewModule) {
    return null;
  }

  const normalizedModule = satellitePreviewModule as SatellitePreviewModuleShape;
  return (
    normalizedModule.resolveOpportunitySatelliteLocator ??
    normalizedModule.default?.resolveOpportunitySatelliteLocator ??
    null
  );
};

const resolveSatellitePreviewTraceExport = (
  satellitePreviewModule: SatellitePreviewModule | null,
) => {
  if (!satellitePreviewModule) {
    return null;
  }

  const normalizedModule = satellitePreviewModule as SatellitePreviewModuleShape;
  return (
    normalizedModule.getSatellitePreviewDebugTrace ??
    normalizedModule.default?.getSatellitePreviewDebugTrace ??
    null
  );
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
      "cache-control": responseCacheControl,
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
  debugSatelliteRoute("request", slug, Boolean(opportunity));

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
    debugSatelliteRoute("static-hit", slug);
    return staticSatellitePreviewResponse;
  }

  const satellitePreviewModule = await loadSatellitePreviewModule();
  const resolveSatellitePreview = resolveSatellitePreviewModuleExport(satellitePreviewModule);
  const resolveSatelliteLocator = resolveSatelliteLocatorModuleExport(satellitePreviewModule);
  debugSatelliteRoute("module-export", slug, Boolean(resolveSatellitePreview));
  if (resolveSatellitePreview) {
    try {
      const satellitePreview = await resolveSatellitePreview(opportunity);
      if (satellitePreview) {
        const response = buildBinaryImageResponse(satellitePreview, satellitePreviewContentType);
        if (process.env.NODE_ENV === "development") {
          response.headers.set("x-arch-image-source", "runtime");
        }
        debugSatelliteRoute("runtime-hit", slug, satellitePreview.byteLength ?? satellitePreview.length ?? 0);
        return response;
      }
      debugSatelliteRoute("runtime-null", slug);
    } catch {
      debugSatelliteRoute("runtime-error", slug);
      // Fall back to the placeholder if the runtime cannot load the satellite preview pipeline.
    }
  }

  if (resolveSatelliteLocator) {
    try {
      const geocodedLocator = await resolveSatelliteLocator(opportunity);
      if (geocodedLocator) {
        debugSatelliteRoute("locator-hit", slug, geocodedLocator.locationLabel ?? null);
        const response = buildGeocodedPlaceholderResponse(opportunity, geocodedLocator);
        if (process.env.NODE_ENV === "development") {
          response.headers.set("x-arch-image-source", "locator");
        }
        return response;
      }
      debugSatelliteRoute("locator-null", slug);
    } catch {
      debugSatelliteRoute("locator-error", slug);
    }
  }

  const traceReader = resolveSatellitePreviewTraceExport(satellitePreviewModule);
  const debugTrace = traceReader ? traceReader(slug) : [];
  const placeholderResponse = buildPlaceholderResponse(opportunity);
  if (process.env.NODE_ENV === "development") {
    placeholderResponse.headers.set("x-arch-image-source", "placeholder");
    if (debugTrace.length > 0) {
      placeholderResponse.headers.set(
        "x-arch-satellite-trace",
        debugTrace.join(" | ").slice(0, 1800),
      );
    }
  }
  debugSatelliteRoute("placeholder", slug);
  return placeholderResponse;
};
