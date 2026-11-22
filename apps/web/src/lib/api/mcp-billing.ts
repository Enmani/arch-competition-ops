import {
  createLogger, mcpBillingCheckoutRequestSchema, mcpBillingSessionRequestSchema, type McpBillingReturn,
} from "@arch-competition/core";
import { systemClock, type Clock, type Storage } from "@arch-competition/storage";
import { readRequestBody } from "@modelcontextprotocol/sdk/server/requestBody.js";
import Stripe from "stripe";

import { requireApiUser, type AuthDeps } from "../auth";
import { checkoutHasSubscription, createStripeClient, stripeCustomerForEvent, stripePaidUntil } from "../mcp/stripe";
import { resolveSiteOrigin } from "../site-url";
import { assertSameOrigin } from "./csrf";
import { guarded, HttpError, jsonResponse, readJsonBody } from "./http";

const logger = createLogger("web.mcp.billing");
const CHECKOUT_WINDOW_SECONDS = 2 * 60 * 60;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const defaultBillingOrigin = "https://arch-competition.com";

type BillingDeps = AuthDeps & {
  clock?: Clock;
  createStripe?: typeof createStripeClient;
};

const temporarilyUnavailable = (message: string, seconds = 10) =>
  new HttpError("billing_unavailable", message, { "Retry-After": String(seconds) });

const getBilling = (deps: BillingDeps) => {
  const env = deps.environment ?? process.env;
  const secret = env.STRIPE_MCP_SECRET_KEY;
  const month = env.STRIPE_MCP_PRICE_ID_MONTH;
  const year = env.STRIPE_MCP_PRICE_ID_YEAR;
  const webhookSecret = env.STRIPE_MCP_WEBHOOK_SECRET;
  const origin = resolveSiteOrigin({ configured: env.SITE_URL ?? defaultBillingOrigin });
  if (!secret || !/^(sk|rk)_test_\S+$/.test(secret) || !month?.startsWith("price_") || !year?.startsWith("price_") ||
      !webhookSecret?.startsWith("whsec_") || !origin ||
      (!origin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin))) {
    throw temporarilyUnavailable("Test billing is unavailable. Keep using your current plan and try again later.", 60);
  }
  return { stripe: (deps.createStripe ?? createStripeClient)(secret), priceIds: { month, year }, webhookSecret, origin };
};

const stripeRequest = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation();
  } catch (error) {
    const status = error instanceof Stripe.errors.StripeError ? error.statusCode : undefined;
    logger.warn("stripe_request_failed", { status });
    throw temporarilyUnavailable("Stripe could not complete the request. Try again shortly.");
  }
};

const dashboard = (origin: string, locale: string, result: McpBillingReturn) => {
  const url = new URL(`/${locale}/dashboard`, origin);
  url.searchParams.set("billing", result);
  return url.href;
};

type BillingStore = Storage["mcpBilling"];
type BillingAccount = NonNullable<Awaited<ReturnType<BillingStore["findAccount"]>>>;

const createCheckoutSession = async (
  { stripe, priceIds, origin }: ReturnType<typeof getBilling>, store: BillingStore, customerId: string, account: BillingAccount,
) => {
  const { checkoutLocale, checkoutInterval, checkoutExpiresAt, checkoutAttemptId } = account;
  if (!checkoutLocale || !checkoutInterval || !checkoutExpiresAt || !checkoutAttemptId) {
    throw new Error("Missing checkout attempt.");
  }
  const session = await stripeRequest(() => stripe.checkout.sessions.create({
    mode: "subscription",
    locale: checkoutLocale,
    customer: customerId,
    expires_at: checkoutExpiresAt,
    line_items: [{ price: priceIds[checkoutInterval], quantity: 1 }],
    success_url: dashboard(origin, checkoutLocale, "success"),
    cancel_url: dashboard(origin, checkoutLocale, "cancel"),
  }, { idempotencyKey: `arch-mcp-checkout:${customerId}:${checkoutAttemptId}` }));
  await store.saveCheckoutSession(account.userId, checkoutAttemptId, session.id);
  return session;
};

export const createMcpBillingHandlers = (deps: BillingDeps) => {
  const clock = deps.clock ?? systemClock;
  return {
    checkout: guarded("POST /api/mcp/billing/checkout", async (request: Request) => {
      assertSameOrigin(request);
      const user = await requireApiUser(request, deps);
      const { locale, interval } = await readJsonBody(request, mcpBillingCheckoutRequestSchema);
      const billing = getBilling(deps);
      const { stripe } = billing;
      const store = (await deps.getStorage()).mcpBilling;
      let account = await store.findAccount({ userId: user.id });
      if (!account?.customerId) {
        const customer = await stripeRequest(() => stripe.customers.create(
          { email: user.email }, { idempotencyKey: `arch-mcp-customer:${user.id}` },
        ));
        account = await store.setCustomer(user.id, customer.id);
      }
      const customerId = account.customerId;
      if (!customerId) throw new Error("Missing Stripe customer for account.");
      const now = Math.floor(clock.now().getTime() / 1000);
      const hasOpenWindow = Boolean(account.checkoutExpiresAt && account.checkoutExpiresAt > now);
      let sessionId = hasOpenWindow ? account.checkoutSessionId : null;
      const switchingInterval = account.checkoutInterval !== interval;
      if (hasOpenWindow && switchingInterval && !sessionId) {
        // Recover the previous idempotent creation before replacing its attempt.
        const previous = await createCheckoutSession(billing, store, customerId, account);
        sessionId = previous.id;
      }
      const existing = sessionId
        ? await stripeRequest(() => stripe.checkout.sessions.retrieve(sessionId))
        : undefined;
      if (await stripeRequest(() => checkoutHasSubscription(stripe, customerId))) {
        throw new HttpError("conflict", "A subscription already exists. Open the customer portal to manage it or update payment.");
      }

      if (existing?.status === "open") {
        if (!switchingInterval && existing.url) return jsonResponse({ url: existing.url });
        await stripeRequest(() => stripe.checkout.sessions.expire(existing.id, {}, {
          idempotencyKey: `arch-mcp-checkout-expire:${existing.id}`,
        }));
      }

      const attempt = !hasOpenWindow || existing
        ? await store.claimCheckout({
          userId: user.id, previousAttempt: account.checkoutAttemptId,
          expiresAt: now + CHECKOUT_WINDOW_SECONDS, locale, interval,
        })
        : account;
      if (attempt?.checkoutInterval !== interval) {
        throw temporarilyUnavailable("Another checkout changed the billing interval. Try again shortly.");
      }
      const session = await createCheckoutSession(billing, store, customerId, attempt);
      if (!session.url) throw temporarilyUnavailable("Checkout is unavailable. Try again shortly.");
      return jsonResponse({ url: session.url });
    }),

    portal: guarded("POST /api/mcp/billing/portal", async (request: Request) => {
      assertSameOrigin(request);
      const user = await requireApiUser(request, deps);
      const { locale } = await readJsonBody(request, mcpBillingSessionRequestSchema);
      const { stripe, origin } = getBilling(deps);
      const account = await (await deps.getStorage()).mcpBilling.findAccount({ userId: user.id });
      const customerId = account?.customerId;
      if (!customerId) throw new HttpError("not_found", "Start checkout before opening the customer portal.");
      const session = await stripeRequest(() => stripe.billingPortal.sessions.create({
        customer: customerId, locale, return_url: dashboard(origin, locale, "portal"),
      }));
      return jsonResponse({ url: session.url });
    }),

    webhook: guarded("POST /api/mcp/billing/webhook", async (request: Request) => {
      const { stripe, webhookSecret, priceIds } = getBilling(deps);
      const signature = request.headers.get("stripe-signature");
      if (!signature) throw new HttpError("invalid_request", "Missing Stripe signature.");
      const payload = await readRequestBody(request, 256 * 1024);
      if (payload.tooLarge) throw new HttpError("invalid_request", "Stripe event exceeds 256 KiB.");
      let event;
      try {
        event = await stripe.webhooks.constructEventAsync(
          payload.text, signature, webhookSecret, SIGNATURE_TOLERANCE_SECONDS,
          Stripe.createSubtleCryptoProvider(), clock.now().getTime(),
        );
        if (event.livemode !== false || !event.id || !event.data?.object) throw new Error("Expected a Stripe test event.");
      } catch {
        throw new HttpError("invalid_request", "Invalid Stripe test event or signature.");
      }
      const store = (await deps.getStorage()).mcpBilling;
      if (!await store.hasEvent(event.id)) {
        const customerId = await stripeRequest(() => stripeCustomerForEvent(stripe, event));
        const account = customerId ? await store.findAccount({ customerId }) : undefined;
        if (account && customerId) {
          const paidUntil = await stripeRequest(() => stripePaidUntil(stripe, customerId, Object.values(priceIds)));
          const outcome = await store.applyEvent({ eventId: event.id, userId: account.userId, revision: account.revision, paidUntil });
          if (outcome === "retry") throw temporarilyUnavailable("Billing state changed. Retry this event.");
        }
      }
      return jsonResponse({ received: true });
    }),
  };
};
