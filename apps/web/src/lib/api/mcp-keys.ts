import {
  MCP_MAX_ACTIVE_KEYS, mcpApiKeyCreateSchema, mcpApiKeyRevokeSchema,
} from "@arch-competition/core";

import { requireApiUser, type AuthDeps } from "../auth";
import { assertSameOrigin } from "./csrf";
import { guarded, HttpError, jsonResponse, readJsonBody } from "./http";

export const createMcpKeyHandlers = (deps: AuthDeps) => ({
  GET: guarded("GET /api/mcp/keys", async (request: Request) => {
    const user = await requireApiUser(request, deps);
    const items = await (await deps.getStorage()).mcp.listKeys(user.id);
    return jsonResponse({ items, maxActiveKeys: MCP_MAX_ACTIVE_KEYS });
  }),
  POST: guarded("POST /api/mcp/keys", async (request: Request) => {
    assertSameOrigin(request);
    const user = await requireApiUser(request, deps);
    const { name } = await readJsonBody(request, mcpApiKeyCreateSchema);
    const created = await (await deps.getStorage()).mcp.createKey(user.id, name);
    if (!created) throw new HttpError("conflict", "Revoke an active API key before creating another.");
    return jsonResponse(created, { status: 201 });
  }),
  DELETE: guarded("DELETE /api/mcp/keys", async (request: Request) => {
    assertSameOrigin(request);
    const user = await requireApiUser(request, deps);
    const { id } = await readJsonBody(request, mcpApiKeyRevokeSchema);
    const item = await (await deps.getStorage()).mcp.revokeKey(user.id, id);
    if (!item) throw new HttpError("not_found", "Refresh your API key list and select one of your keys.");
    return jsonResponse(item);
  }),
});

export const createMcpUsageHandler = (deps: AuthDeps) => guarded("GET /api/mcp/usage", async (request: Request) => {
  const user = await requireApiUser(request, deps);
  return jsonResponse(await (await deps.getStorage()).mcp.getUsage(user.id));
});
