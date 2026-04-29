import { getStoredOpportunityFeedItemBySlug } from "@arch-competition/storage";

import { resolveOpportunityCardImageUrl } from "@/lib/opportunity-card-image";
import { buildOpportunityLocatorPlaceholderSvg } from "@/lib/opportunity-card-placeholder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const buildPlaceholderResponse = (opportunity?: ReturnType<typeof getStoredOpportunityFeedItemBySlug>, status = 200) =>
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

type OpportunityImageRouteContext = {
  params: Promise<{ slug: string }>;
};

export const GET = async (
  _request: Request,
  { params }: OpportunityImageRouteContext,
) => {
  const { slug } = await params;
  const opportunity = getStoredOpportunityFeedItemBySlug(slug);

  if (!opportunity) {
    return buildPlaceholderResponse(undefined, 404);
  }

  const imageUrl = await resolveOpportunityCardImageUrl(opportunity);
  if (imageUrl) {
    const imageResponse = await fetchImageResponse(imageUrl);
    if (imageResponse) {
      return imageResponse;
    }
  }

  return buildPlaceholderResponse(opportunity);
};
