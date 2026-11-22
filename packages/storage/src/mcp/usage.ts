import { MCP_PLANS, type McpPlan, type McpUsage } from "@arch-competition/core";

import { sha256Hex } from "../auth/encoding";
import type { StorageContext } from "../context";
import { readBatch, readRow } from "../driver/sql";
import type { McpKeyPrincipal } from "./keys";

const MINUTE_SECONDS = 60;
const unixSeconds = (date: Date) => Math.floor(date.getTime() / 1000);
const monthStart = (date: Date, offset = 0) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1) / 1000;

const state = `
  WITH input(subject, user_id, key_id, now, month_start, minute_start) AS (VALUES (?, ?, ?, ?, ?, ?)),
  plans(plan, monthly_limit, minute_limit) AS (VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)),
  eligible AS (
    SELECT input.*, CASE
      WHEN input.user_id IS NULL THEN 'anonymous'
      WHEN account.paid_until > input.now THEN 'paid'
      ELSE 'free'
    END AS plan
    FROM input
    LEFT JOIN mcp_billing_accounts account ON account.user_id = input.user_id
    WHERE input.key_id IS NULL OR EXISTS (
      SELECT 1 FROM api_keys WHERE id = input.key_id AND user_id = input.user_id AND revoked_at IS NULL
    )
  ),
  current_usage AS (
    SELECT eligible.subject, eligible.user_id, plans.*,
      max(eligible.month_start, coalesce(usage.month_start, 0)) AS month_start,
      CASE WHEN usage.month_start >= eligible.month_start THEN usage.month_count ELSE 0 END AS month_count,
      max(eligible.minute_start, coalesce(usage.minute_start, 0)) AS minute_start,
      CASE WHEN usage.minute_start >= eligible.minute_start THEN usage.minute_count ELSE 0 END AS minute_count
    FROM eligible JOIN plans ON plans.plan = eligible.plan
    LEFT JOIN mcp_usage usage ON usage.subject = eligible.subject
  )
`;

type UsageRow = {
  plan: McpPlan;
  month_start: number;
  month_count: number;
  monthly_limit: number;
  minute_start: number;
  minute_count: number;
  minute_limit: number;
};

const usageView = (row: UsageRow): McpUsage => ({
  plan: row.plan,
  month: {
    used: row.month_count,
    limit: row.monthly_limit,
    resetsAt: new Date(monthStart(new Date(row.month_start * 1000), 1) * 1000).toISOString(),
  },
  minute: {
    used: row.minute_count,
    limit: row.minute_limit,
    resetsAt: new Date((row.minute_start + MINUTE_SECONDS) * 1000).toISOString(),
  },
});

const stateParameters = (subject: string, userId: string | null, keyId: string | null, date: Date) => {
  const now = unixSeconds(date);
  return [
    subject, userId, keyId, now, monthStart(date), now - now % MINUTE_SECONDS,
    ...Object.entries(MCP_PLANS).flatMap(([plan, { monthlyLimit, minuteLimit }]) => [plan, monthlyLimit, minuteLimit]),
  ];
};

const accountSubject = (userId: string) => `user:${userId}`;

export const getMcpUsage = async (context: StorageContext, userId: string) => {
  const row = await readRow<UsageRow>(context.writer, state + "SELECT * FROM current_usage",
    stateParameters(accountSubject(userId), userId, null, context.clock.now()));
  if (!row) throw new Error("Missing MCP usage state.");
  return usageView(row);
};

export type McpCallPrincipal = McpKeyPrincipal | { anonymousIp: string; salt: string };

export const reserveMcpCall = async (context: StorageContext, principal: McpCallPrincipal) => {
  const key = "userId" in principal ? principal : null;
  const subject = "anonymousIp" in principal
    ? `anon:${await sha256Hex(JSON.stringify([principal.salt, principal.anonymousIp]))}`
    : accountSubject(principal.userId);
  const now = context.clock.now();
  const parameters = stateParameters(subject, key?.userId ?? null, key?.id ?? null, now);
  // D1 batch is a transaction. The single conditional write admits both windows or neither.
  // Checking the key again in that write closes the gap between digest verification and revocation.
  const [admitted, rows] = await readBatch(context.writer, [
    {
      parameters,
      sql: state + `
        INSERT INTO mcp_usage (subject, user_id, month_start, month_count, minute_start, minute_count)
        SELECT subject, user_id, month_start, month_count + 1, minute_start, minute_count + 1
        FROM current_usage WHERE month_count < monthly_limit AND minute_count < minute_limit
        ON CONFLICT(subject) DO UPDATE SET month_start = excluded.month_start, month_count = excluded.month_count,
          minute_start = excluded.minute_start, minute_count = excluded.minute_count
        RETURNING subject
      `,
    },
    { parameters, sql: state + "SELECT * FROM current_usage" },
    ...(key ? [{
      parameters: [now.toISOString(), key.id, key.userId, now.toISOString()],
      sql: `UPDATE api_keys SET last_used_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND (last_used_at IS NULL OR last_used_at < ?)`,
    }] : []),
  ]);
  const row = rows[0] as UsageRow | undefined;
  if (!row) return null;
  const usage = usageView(row);
  const retryAfter = admitted.length > 0 ? 0 : Math.max(
    usage.month.used >= usage.month.limit ? Date.parse(usage.month.resetsAt) : 0,
    usage.minute.used >= usage.minute.limit ? Date.parse(usage.minute.resetsAt) : 0,
  ) - now.getTime();
  return { usage, retryAfter: Math.ceil(retryAfter / 1000) };
};
