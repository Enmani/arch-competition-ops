import { createOpportunityImageHandler } from "@/lib/opportunity-image-response";
import { getPreviewSource } from "@/lib/opportunity-preview-assets";
import { opportunityImageRevision } from "@/lib/opportunity-preview-revision";
import { getWebOpportunityLocation } from "@/lib/server-storage";

/**
 * Card image for an opportunity: a prebuilt asset from the preview manifest, else the locator
 * placeholder. Generation is offline (`npm run prewarm:previews`); see opportunity-image-response.
 */
export const dynamic = "force-dynamic";

const development = process.env.NODE_ENV === "development";

const handle = createOpportunityImageHandler({
  development,
  getOpportunity: getWebOpportunityLocation,
  getPreviewSource,
  revision: opportunityImageRevision,
});

type OpportunityImageRouteContext = {
  params: Promise<{ slug: string }>;
};

export const GET = async (request: Request, { params }: OpportunityImageRouteContext) =>
  handle(request, (await params).slug);
