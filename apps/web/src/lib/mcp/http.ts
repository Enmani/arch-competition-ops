import { readRequestBody } from "@modelcontextprotocol/sdk/server/requestBody.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { JSONRPCRequestSchema, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import type { Clock } from "@arch-competition/storage";

import { authorizeMcp, dashboardUrl, logMcpCall, mcpLimitHint, quotaHeaders, type McpAccess } from "./access";
import { createCompetitionServer, type GetPublicReads } from "./server";

const browserOrigins = new Set([
  "https://arch-competition.com", "https://www.arch-competition.com",
  "http://localhost:3400", "http://127.0.0.1:3400", "http://[::1]:3400",
]);

const rpcError = (status: number, code: number, message: string, id: unknown = null, headers?: HeadersInit) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers });

export const createMcpHandler = (getReads: GetPublicReads, access: McpAccess, clock?: Clock) => async (request: Request) => {
  const started = performance.now();
  const origin = request.headers.get("origin");
  if (origin !== null && !browserOrigins.has(origin)) return rpcError(403, -32000, "Unrecognized Origin.");
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });

  // The SDK also accepts JSON-RPC batches. Limit this endpoint to one database operation per call.
  const body = await readRequestBody(request, 16 * 1024);
  if (body.tooLarge) return rpcError(413, -32600, "Send one MCP message of at most 16 KiB.");
  let message;
  try {
    message = JSON.parse(body.text);
  } catch {
    return rpcError(400, -32700, "Send a valid JSON-RPC object.");
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(400, -32600, "Send one JSON-RPC object per POST.");
  }

  const rpc = JSONRPCRequestSchema.safeParse(message);
  const isCall = rpc.success && rpc.data.method === "tools/call";
  const id = rpc.success ? rpc.data.id : null;
  const tool = isCall ? rpc.data.params?.name : undefined;

  // Let the transport report invalid headers before treating a message as a tool call.
  const accept = request.headers.get("accept") ?? "";
  const version = request.headers.get("mcp-protocol-version");
  const meter = isCall && accept.includes("application/json") && accept.includes("text/event-stream") &&
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json" &&
    (version === null || SUPPORTED_PROTOCOL_VERSIONS.includes(version));
  const attemptedSubject = request.headers.has("authorization") ? "key" : "anonymous";
  let reservation;
  try {
    reservation = await authorizeMcp(request, access, meter);
  } catch {
    if (isCall) logMcpCall(started, tool, attemptedSubject, "unavailable");
    return rpcError(503, -32000, "MCP access is temporarily unavailable. Retry in a few seconds.", id, {
      "Cache-Control": "no-store", "Retry-After": "5",
    });
  }
  if (reservation.kind === "invalid") {
    if (isCall) logMcpCall(started, tool, attemptedSubject, "invalid_key");
    return rpcError(401, -32002, `Invalid or revoked API key. Create or select an active key at ${dashboardUrl(request)}.`, id, {
      "Cache-Control": "no-store", "WWW-Authenticate": 'Bearer realm="arch-competition", error="invalid_token"',
    });
  }
  const metered = reservation.kind === "metered" ? reservation : null;
  const quota = metered ? quotaHeaders(metered.usage) : undefined;
  if (metered && metered.retryAfter > 0) {
    quota?.set("Retry-After", String(metered.retryAfter));
    logMcpCall(started, tool, attemptedSubject, "rate_limited");
    return rpcError(429, -32029, mcpLimitHint(metered.usage, request), id, quota);
  }

  const server = createCompetitionServer(getReads, clock);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: message });
    if (!response.body) return response;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 128 * 1024) {
      if (isCall) logMcpCall(started, tool, attemptedSubject, "response_too_large");
      return rpcError(200, -32000, "Result exceeds 128 KiB. Reduce the page limit or consult the source notice for an oversized record.", id, quota);
    }
    if (isCall) {
      const result = JSON.parse(new TextDecoder().decode(bytes));
      const status = response.ok && !result.error && !result.result?.isError ? "ok" : "error";
      logMcpCall(started, tool, attemptedSubject, status);
    }
    const headers = new Headers(response.headers);
    quota?.forEach((value, name) => headers.set(name, value));
    return new Response(bytes, { status: response.status, headers });
  } finally {
    await server.close();
  }
};
