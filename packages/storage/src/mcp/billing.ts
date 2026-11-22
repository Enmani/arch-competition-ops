import type { McpBillingInterval } from "@arch-competition/core";

import type { StorageContext } from "../context";
import { execute, executeBatch, readRow } from "../driver/sql";

const billingFields = `user_id, stripe_customer_id, billing_revision, checkout_expires_at,
  checkout_locale, checkout_interval, checkout_attempt_id, checkout_session_id`;

type BillingRow = {
  user_id: string;
  stripe_customer_id: string | null;
  billing_revision: number;
  checkout_expires_at: number | null;
  checkout_locale: "en" | "zh" | null;
  checkout_interval: McpBillingInterval | null;
  checkout_attempt_id: string | null;
  checkout_session_id: string | null;
};

const mapBilling = (row: BillingRow | undefined) => row && ({
  userId: row.user_id,
  customerId: row.stripe_customer_id,
  revision: row.billing_revision,
  checkoutExpiresAt: row.checkout_expires_at,
  checkoutLocale: row.checkout_locale,
  checkoutInterval: row.checkout_interval,
  checkoutAttemptId: row.checkout_attempt_id,
  checkoutSessionId: row.checkout_session_id,
});

export const findBillingAccount = async (context: StorageContext, account: { userId: string } | { customerId: string }) =>
  mapBilling(await readRow<BillingRow>(context.writer,
    `SELECT ${billingFields} FROM mcp_billing_accounts WHERE ${"userId" in account ? "user_id" : "stripe_customer_id"} = ?`,
    ["userId" in account ? account.userId : account.customerId]));

export const setBillingCustomer = async (context: StorageContext, userId: string, customerId: string) => {
  const row = await readRow<BillingRow>(context.writer, `
    INSERT INTO mcp_billing_accounts (user_id, stripe_customer_id) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id = COALESCE(mcp_billing_accounts.stripe_customer_id, excluded.stripe_customer_id)
    RETURNING ${billingFields}
  `, [userId, customerId]);
  if (!row) throw new Error("Missing MCP billing account after linking Stripe customer.");
  return mapBilling(row)!;
};

/** Replaces the previously observed attempt. Returns the current attempt if another caller won. */
export const claimCheckout = async (context: StorageContext, input: {
  userId: string;
  previousAttempt: string | null;
  expiresAt: number;
  locale: "en" | "zh";
  interval: McpBillingInterval;
}) => {
  const row = await readRow<BillingRow>(context.writer, `
    UPDATE mcp_billing_accounts SET checkout_locale = ?, checkout_interval = ?, checkout_expires_at = ?,
      checkout_attempt_id = ?, checkout_session_id = NULL
    WHERE user_id = ? AND checkout_attempt_id IS ? RETURNING ${billingFields}
  `, [input.locale, input.interval, input.expiresAt, crypto.randomUUID(), input.userId, input.previousAttempt]);
  return mapBilling(row) ?? findBillingAccount(context, { userId: input.userId });
};

export const saveCheckoutSession = async (context: StorageContext, userId: string, attemptId: string, sessionId: string) =>
  execute(context.writer, `UPDATE mcp_billing_accounts SET checkout_session_id = ?
    WHERE user_id = ? AND checkout_attempt_id = ?`, [sessionId, userId, attemptId]);

export const hasStripeEvent = async (context: StorageContext, eventId: string) =>
  Boolean(await readRow(context.writer, "SELECT 1 FROM mcp_stripe_events WHERE id = ?", [eventId]));

export const applyStripeEvent = async (context: StorageContext, input: {
  eventId: string;
  userId: string;
  revision: number;
  paidUntil: number;
}) => {
  const { eventId, userId, revision, paidUntil } = input;
  // The receipt and entitlement advance together. A rival event that committed after
  // this handler read Stripe invalidates the snapshot and forces a fresh read on retry.
  const [receipt] = await executeBatch(context.writer, [
    {
      parameters: [eventId, context.clock.now().toISOString(), userId, revision],
      sql: `INSERT INTO mcp_stripe_events (id, processed_at, user_id, billing_revision)
        SELECT ?, ?, user_id, billing_revision FROM mcp_billing_accounts
        WHERE user_id = ? AND billing_revision = ?
        ON CONFLICT(id) DO NOTHING`,
    },
    {
      parameters: [paidUntil, userId, revision, eventId],
      sql: `UPDATE mcp_billing_accounts SET paid_until = ?, billing_revision = billing_revision + 1
        WHERE user_id = ? AND billing_revision = ?
        AND EXISTS (SELECT 1 FROM mcp_stripe_events e WHERE e.id = ?
          AND e.user_id = mcp_billing_accounts.user_id AND e.billing_revision = mcp_billing_accounts.billing_revision)`,
    },
  ]);
  if (receipt.changes > 0) return "applied";
  return await hasStripeEvent(context, eventId) ? "duplicate" : "retry";
};
