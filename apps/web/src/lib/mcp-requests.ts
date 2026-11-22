import {
  mcpApiKeyCreatedSchema, mcpApiKeyListSchema, mcpApiKeySchema, mcpBillingSessionSchema, mcpUsageSchema,
  type McpBillingInterval,
} from "@arch-competition/core";

import type { AppLocale } from "../i18n/config";
import { requestJson, sendJson, type ApiFailure } from "./api-client";
import { mcpNextStep, type McpNextStep, type McpOperation } from "./mcp-account";

/**
 * Browser calls to the MCP account API. Responses are checked against core's schemas before use;
 * a body of the wrong shape counts as a server error rather than reaching the UI.
 */
type Schema<Data> = { safeParse(input: unknown): { success: true; data: Data } | { success: false } };

export type McpResult<Data> = { data: Data; ok: true } | { failure: McpFailure; ok: false };
export type McpFailure = { retryAfterSeconds: number | null; step: McpNextStep };

const malformed: ApiFailure = { kind: "generic", retryAfterSeconds: null, status: 500 };

const run = async <Data>(
  operation: McpOperation,
  schema: Schema<Data>,
  request: Promise<{ data: unknown; ok: true } | { failure: ApiFailure; ok: false }>,
): Promise<McpResult<Data>> => {
  const result = await request;
  let reason = malformed;
  if (result.ok) {
    const parsed = schema.safeParse(result.data);
    if (parsed.success) return { data: parsed.data, ok: true };
  } else {
    reason = result.failure;
  }
  return {
    failure: { retryAfterSeconds: reason.retryAfterSeconds, step: mcpNextStep(operation, reason) },
    ok: false,
  };
};

export const listMcpKeys = () => run("listKeys", mcpApiKeyListSchema, requestJson("/api/mcp/keys"));

export const createMcpKey = (name: string) =>
  run("createKey", mcpApiKeyCreatedSchema, sendJson("/api/mcp/keys", "POST", { name }));

export const revokeMcpKey = (id: string) => run("revokeKey", mcpApiKeySchema, sendJson("/api/mcp/keys", "DELETE", { id }));

export const readMcpUsage = () => run("usage", mcpUsageSchema, requestJson("/api/mcp/usage"));

export const startMcpCheckout = (locale: AppLocale, interval: McpBillingInterval) =>
  run("checkout", mcpBillingSessionSchema, sendJson("/api/mcp/billing/checkout", "POST", { interval, locale }));

export const openMcpPortal = (locale: AppLocale) =>
  run("portal", mcpBillingSessionSchema, sendJson("/api/mcp/billing/portal", "POST", { locale }));
