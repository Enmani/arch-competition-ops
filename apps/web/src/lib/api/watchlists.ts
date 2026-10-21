import { watchlistLimitQuerySchema, watchlistMutationSchema } from "@arch-competition/core";
import { workspaceKeyForUser } from "@arch-competition/storage";

import { requireApiUser, type AuthDeps } from "../auth";
import { assertSameOrigin } from "./csrf";
import { guarded, jsonResponse, parseWith, readJsonBody } from "./http";

/**
 * Watchlist API. Every route requires a signed-in user; the workspace is derived from the
 * session (`user:<id>`), never from the request, so users cannot reach each other's data.
 */
export const createWatchlistHandlers = (deps: AuthDeps) => ({
  GET: guarded("GET /api/watchlists", async (request: Request) => {
    const user = await requireApiUser(request, deps);
    const { limit } = parseWith(
      watchlistLimitQuerySchema,
      { limit: new URL(request.url).searchParams.get("limit") },
      "query",
    );
    const storage = await deps.getStorage();
    const workspaceKey = workspaceKeyForUser(user.id);

    return jsonResponse({
      items: await storage.watchlist.list({ limit, workspaceKey }),
      watchedOpportunityIds: await storage.watchlist.listIds(workspaceKey),
    });
  }),

  POST: guarded("POST /api/watchlists", async (request: Request) => {
    assertSameOrigin(request);
    const user = await requireApiUser(request, deps);
    const { opportunityId } = await readJsonBody(request, watchlistMutationSchema);
    const item = await (await deps.getStorage()).watchlist.add({
      opportunityId,
      workspaceKey: workspaceKeyForUser(user.id),
    });
    return jsonResponse({ item }, { status: 201 });
  }),

  DELETE: guarded("DELETE /api/watchlists", async (request: Request) => {
    assertSameOrigin(request);
    const user = await requireApiUser(request, deps);
    const { opportunityId } = await readJsonBody(request, watchlistMutationSchema);
    const deleted = await (await deps.getStorage()).watchlist.remove({
      opportunityId,
      workspaceKey: workspaceKeyForUser(user.id),
    });
    return jsonResponse({ alreadyDeleted: !deleted, deleted: true, opportunityId });
  }),
});
