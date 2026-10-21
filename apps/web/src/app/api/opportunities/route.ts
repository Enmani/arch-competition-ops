import { apiDeps } from "@/lib/api/deps";
import { createOpportunitiesHandlers } from "@/lib/api/opportunities";

export const dynamic = "force-dynamic";

export const { GET } = createOpportunitiesHandlers(apiDeps);
