import { MCP_ANONYMOUS_DAILY_BUDGET, MCP_PLANS, type McpPlan, type McpUsage } from "@arch-competition/core";

import { sha256Hex } from "../auth/encoding";
import type { StorageContext } from "../context";
import { readBatch, readRow } from "../driver/sql";
import type { McpKeyPrincipal } from "./keys";

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 86_400;
const HOUR_MS = 3_600_000;
const ANONYMOUS_BUDGET_SUBJECT = "global:anonymous";
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

// The reserved row uses the month columns for its UTC day start and count.
const dailyState = `
  , daily_input(subject, day_start, daily_limit) AS (VALUES (?, ?, ?)),
  daily_usage AS (
    SELECT input.subject, input.daily_limit,
      max(input.day_start, coalesce(usage.month_start, 0)) AS day_start,
      CASE WHEN usage.month_start >= input.day_start THEN usage.month_count ELSE 0 END AS day_count
    FROM daily_input input LEFT JOIN mcp_usage usage ON usage.subject = input.subject
  )
`;

type UsageRow = {
  daily_limit_day_start?: number | null;
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
  const seconds = unixSeconds(now);
  if (!key) parameters.push(ANONYMOUS_BUDGET_SUBJECT, seconds - seconds % DAY_SECONDS, MCP_ANONYMOUS_DAILY_BUDGET);
  const reservationState = key ? state : state + dailyState;
  // D1 runs the batch in one transaction. The upsert checks the active key and writes
  // all applicable quotas or none. Only admitted anonymous calls increment the daily row.
  const [admitted, rows] = await readBatch(context.writer, [
    {
      parameters,
      sql: reservationState + `
        , admitted AS (
          SELECT * FROM current_usage WHERE month_count < monthly_limit AND minute_count < minute_limit
          ${key ? "" : "AND (SELECT day_count < daily_limit FROM daily_usage)"}
        )
        INSERT INTO mcp_usage (subject, user_id, month_start, month_count, minute_start, minute_count)
        SELECT subject, user_id, month_start, month_count + 1, minute_start, minute_count + 1 FROM admitted WHERE true
        ${key ? "" : `UNION ALL SELECT subject, NULL, day_start, day_count + 1, 0, 0
          FROM daily_usage WHERE EXISTS (SELECT 1 FROM admitted)`}
        ON CONFLICT(subject) DO UPDATE SET month_start = excluded.month_start, month_count = excluded.month_count,
          minute_start = excluded.minute_start, minute_count = excluded.minute_count
        RETURNING subject
      `,
    },
    {
      parameters,
      sql: reservationState + (key ? "SELECT * FROM current_usage" : `
        SELECT current_usage.*,
          (SELECT day_start FROM daily_usage WHERE day_count >= daily_limit) AS daily_limit_day_start
        FROM current_usage
      `),
    },
    ...(key ? [{
      parameters: [now.toISOString(), key.id, key.userId, new Date(now.getTime() - HOUR_MS).toISOString()],
      sql: `UPDATE api_keys SET last_used_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND (last_used_at IS NULL OR last_used_at <= ?)`,
    }] : []),
  ]);
  const row = rows[0] as UsageRow | undefined;
  if (!row) return null;
  const usage = usageView(row);
  if (admitted.length > 0) return { usage, retryAfter: 0, dailyBudgetReached: false };
  if (row.daily_limit_day_start != null) {
    const retryAfter = Math.ceil((row.daily_limit_day_start + DAY_SECONDS) - now.getTime() / 1000);
    return { usage, retryAfter, dailyBudgetReached: true };
  }
  const resetsAt = Math.max(
    usage.month.used >= usage.month.limit ? Date.parse(usage.month.resetsAt) : 0,
    usage.minute.used >= usage.minute.limit ? Date.parse(usage.minute.resetsAt) : 0,
  );
  return { usage, retryAfter: Math.ceil((resetsAt - now.getTime()) / 1000), dailyBudgetReached: false };
};
