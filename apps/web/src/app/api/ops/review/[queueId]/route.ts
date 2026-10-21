import { apiDeps } from "@/lib/api/deps";
import { createOpsReviewDecisionHandlers } from "@/lib/api/ops-review";

export const dynamic = "force-dynamic";

export const { PATCH } = createOpsReviewDecisionHandlers(apiDeps);
