import {
  parseDiscoverQuery,
  savedSearchCreateSchema,
  savedSearchDeleteSchema,
  savedSearchLimitQuerySchema,
} from "@arch-competition/core";
import { workspaceKeyForUser } from "@arch-competition/storage";

import { requireApiUser, type AuthDeps } from "../auth";
import { assertSameOrigin } from "./csrf";
import { HttpError, guarded, jsonResponse, parseWith, readJsonBody } from "./http";

/** Saved-search API, scoped to the signed-in user's private workspace. */
export const createSavedSearchHandlers = (deps: AuthDeps) => ({
  GET: guarded("GET /api/saved-searches", async (request: Request) => {
    const user = await requireApiUser(request, deps);
    const { limit } = parseWith(
      savedSearchLimitQuerySchema,
      { limit: new URL(request.url).searchParams.get("limit") },
      "query",
    );
    const items = await (await deps.getStorage()).savedSearches.list({
      limit,
      workspaceKey: workspaceKeyForUser(user.id),
    });
    return jsonResponse({ items, limit });
  }),

  POST: guarded("POST /api/saved-searches", async (request: Request) => {
    assertSameOrigin(request);
    const user = await requireApiUser(request, deps);
    const { name, searchParams } = await readJsonBody(request, savedSearchCreateSchema);
    const parsed = parseDiscoverQuery(searchParams, "strict");
    if (!parsed.ok) {
      throw new HttpError("invalid_request", `Invalid searchParams. ${parsed.issues.slice(0, 3).join("; ")}`);
    }

    const item = await (await deps.getStorage()).savedSearches.create({
      filters: parsed.filters,
      name,
      workspaceKey: workspaceKeyForUser(user.id),
    });
    return jsonResponse({ item }, { status: 201 });
  }),

  DELETE: guarded("DELETE /api/saved-searches", async (request: Request) => {
    assertSameOrigin(request);
    const user = await requireApiUser(request, deps);
    const { id } = await readJsonBody(request, savedSearchDeleteSchema);
    const deleted = await (await deps.getStorage()).savedSearches.delete({
      id,
      workspaceKey: workspaceKeyForUser(user.id),
    });
    return jsonResponse({ alreadyDeleted: !deleted, deleted: true, id });
  }),
});
