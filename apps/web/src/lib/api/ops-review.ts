import { opsReviewDecisionSchema, opsReviewListQuerySchema } from "@arch-competition/core";

import { requireApiAdmin, type AuthDeps } from "../auth";
import { assertSameOrigin } from "./csrf";
import { guarded, jsonResponse, parseWith, readJsonBody } from "./http";

/**
 * Operations review API. Reading and deciding both require an administrator
 * (`ARCH_OPS_ADMIN_EMAILS`). The audit actor is the administrator's own email taken from the
 * session; a client-supplied actor is rejected by the request schema.
 */
export const createOpsReviewListHandlers = (deps: AuthDeps) => ({
  GET: guarded("GET /api/ops/review", async (request: Request) => {
    await requireApiAdmin(request, deps);
    const searchParams = new URL(request.url).searchParams;
    const query = parseWith(
      opsReviewListQuerySchema,
      {
        activeOnly: searchParams.get("activeOnly"),
        limit: searchParams.get("limit"),
        reasonCode: searchParams.get("reasonCode"),
        status: searchParams.get("status"),
      },
      "query",
    );
    const storage = await deps.getStorage();
    const activeOnly = query.activeOnly !== "false";

    return jsonResponse({
      activeOnly,
      items: await storage.ops.reviewQueue({
        activeOnly,
        limit: query.limit,
        reasonCode: query.reasonCode,
        status: query.status,
      }),
      limit: query.limit,
      reasonCode: query.reasonCode,
      status: query.status,
      summary: await storage.ops.reviewSummary(),
    });
  }),
});

export const createOpsReviewDecisionHandlers = (deps: AuthDeps) => ({
  PATCH: guarded(
    "PATCH /api/ops/review/[queueId]",
    async (request: Request, context: { params: Promise<{ queueId: string }> }) => {
      assertSameOrigin(request);
      const admin = await requireApiAdmin(request, deps);
      const body = await readJsonBody(request, opsReviewDecisionSchema);
      const { queueId } = await context.params;
      const storage = await deps.getStorage();

      const item = await storage.ops.writeDecision({
        actorLabel: admin.email,
        decision: body.decision,
        note: body.note ?? null,
        queueId,
      });
      return jsonResponse({ item, summary: await storage.ops.reviewSummary() });
    },
  ),
});
