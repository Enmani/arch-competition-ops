import { isIP } from "node:net";

import { createLogger, MCP_ACCOUNT_PATH, type McpUsage } from "@arch-competition/core";
import type { Storage } from "@arch-competition/storage";

const logger = createLogger("web.mcp");
const toolNames = new Set(["search_competitions", "get_competition", "list_closing_soon", "get_taxonomy"]);

export type McpAccess = {
  getStorage: () => Promise<Storage["mcp"]>;
  getAnonymousIp: (request: Request) => string;
  getAnonymousSalt: () => string | undefined;
};

export const cloudflareClientIp = (request: Request) => {
  const ip = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const version = isIP(ip);
  if (version === 6) return new URL(`http://[${ip}]/`).hostname;
  return version === 4 ? ip : "unknown";
};

export const dashboardUrl = (request: Request) => {
  const { origin, hostname } = new URL(request.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  return new URL(MCP_ACCOUNT_PATH, local ? origin : "https://arch-competition.com").href;
};

export const authorizeMcp = async (request: Request, access: McpAccess, isCall: boolean) => {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const token = /^Bearer ([^ ]+)$/i.exec(authorization)?.[1];
    if (!token) return { kind: "invalid" } as const;
    const storage = await access.getStorage();
    const principal = await storage.authenticateKey(token);
    if (!principal) return { kind: "invalid" } as const;
    if (!isCall) return { kind: "discovery" } as const;
    const reservation = await storage.reserveCall(principal);
    return reservation ? { kind: "metered", ...reservation } as const : { kind: "invalid" } as const;
  }
  if (!isCall) return { kind: "discovery" } as const;
  const salt = access.getAnonymousSalt();
  if (!salt) throw new Error("Anonymous MCP metering requires ARCH_MCP_ANONYMOUS_SALT.");
  const reservation = await (await access.getStorage()).reserveCall({ anonymousIp: access.getAnonymousIp(request), salt });
  if (!reservation) throw new Error("Anonymous MCP usage row was not returned.");
  return { kind: "metered", ...reservation } as const;
};

export const quotaHeaders = (usage: McpUsage) => {
  const headers = new Headers({ "Cache-Control": "no-store", "X-RateLimit-Plan": usage.plan });
  for (const [prefix, window] of [["X-RateLimit", usage.minute], ["X-Quota", usage.month]] as const) {
    headers.set(`${prefix}-Limit`, String(window.limit));
    headers.set(`${prefix}-Remaining`, String(Math.max(0, window.limit - window.used)));
    headers.set(`${prefix}-Reset`, String(Date.parse(window.resetsAt) / 1000));
  }
  return headers;
};

export const mcpLimitHint = (usage: McpUsage, request: Request, dailyBudgetReached: boolean) => {
  if (dailyBudgetReached) {
    return `Anonymous access is paused for today because the shared daily limit was reached. You can keep using a free API key. Get one at ${dashboardUrl(request)} or retry after the time indicated by Retry-After.`;
  }
  const reason = usage.month.used >= usage.month.limit ? "Monthly tool quota reached." : "Tool rate limit reached.";
  const retry = "Retry after the time indicated by Retry-After.";
  switch (usage.plan) {
    case "anonymous": return `${reason} Get a free API key at ${dashboardUrl(request)} or wait for the reset. ${retry}`;
    case "free": return `${reason} Upgrade your plan at ${dashboardUrl(request)} or wait for the reset. ${retry}`;
    case "paid": return `${reason} ${retry}`;
  }
};

export const logMcpCall = (started: number, name: unknown, subjectType: string, status: string) => {
  const tool = typeof name === "string" && toolNames.has(name) ? name : "unknown";
  logger.info("mcp_tool_call", { subjectType, tool, status, durationMs: Math.round(performance.now() - started) });
};
