import { apiDeps } from "@/lib/api/deps";
import { createOpsReviewListHandlers } from "@/lib/api/ops-review";

export const dynamic = "force-dynamic";

export const { GET } = createOpsReviewListHandlers(apiDeps);
