import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { mcpBillingSessionSchema, mcpBillingWebhookAckSchema } from "@arch-competition/core";
import { createTestStorage } from "@arch-competition/storage/testing";

import { createMcpBillingHandlers } from "../api/mcp-billing";
import { sessionCookieName } from "../session-cookie";
import { createStripeClient } from "./stripe";

const fakeSecret = "sk_test_local_fixture";
const fakeWebhook = "whsec_local_fixture";
const monthPrice = "price_month_fixture";
const yearPrice = "price_year_fixture";
const fakeCustomer = "cus_local_fixture";
const site = "http://localhost:3400";
const start = "2026-12-31T23:59:50.000Z";
const currentPeriodEnd = Date.parse("2027-02-01T00:00:00Z") / 1000;
const trialEnd = Date.parse("2027-01-01T00:00:00Z") / 1000;

const fixture = async (t: TestContext) => {
  const db = createTestStorage({ now: start });
  t.after(db.cleanup);
  const user = await db.storage.auth.register({ email: "billing@example.test", password: "test-password" });
  const session = await db.storage.auth.createSession({ userId: user.id });
  const cookie = `${sessionCookieName(false)}=${session.token}`;
  const state = {
    subscription: "absent",
    price: monthPrice,
    periodEnd: currentPeriodEnd,
    invoiceStatus: "paid",
    partiallyRefunded: false,
    refunded: false,
    cancelAt: null as number | null,
    requests: [] as { path: string; fields: URLSearchParams; idempotency: string | null }[],
    checkoutRequests: new Map<string, number>(),
    checkoutStatus: "open",
    expiredSessions: new Set<string>(),
  };
  const list = (data: unknown[]) => ({ object: "list", data, has_more: false });
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const idempotency = new Headers(init?.headers).get("idempotency-key");
    const fields = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    const path = url.pathname;
    state.requests.push({ path, fields, idempotency });
    assert.equal(url.origin, "https://api.stripe.com");
    switch (path) {
      case "/v1/customers": return Response.json({ id: fakeCustomer });
      case "/v1/subscriptions": {
        assert.equal(url.searchParams.get("customer"), fakeCustomer);
        return Response.json(list(state.subscription === "absent" ? [] : [{
          id: "sub_local_fixture", status: state.subscription, latest_invoice: "in_local_fixture", trial_end: trialEnd,
          cancel_at: state.cancelAt, items: { data: [{ price: { id: state.price }, current_period_end: state.periodEnd }] },
        }]));
      }
      case "/v1/checkout/sessions": {
        assert.ok(idempotency);
        const previous = state.checkoutRequests.get(idempotency);
        const number = previous ?? state.checkoutRequests.size + 1;
        state.checkoutRequests.set(idempotency, number);
        return Response.json({ id: `cs_test_local_${number}`, url: `https://checkout.stripe.com/c/pay/cs_test_local_${number}` });
      }
      case "/v1/billing_portal/sessions":
        return Response.json({ url: "https://billing.stripe.com/p/session/local" });
      case "/v1/invoices/in_local_fixture":
        return Response.json({ id: "in_local_fixture", status: state.invoiceStatus, amount_paid: 100 });
      case "/v1/invoice_payments":
        assert.equal(url.searchParams.get("invoice"), "in_local_fixture");
        return Response.json(list([{
          amount_paid: 100,
          payment: { type: "payment_intent", payment_intent: { latest_charge: {
            refunded: state.refunded, amount_refunded: state.partiallyRefunded || state.refunded ? 10 : 0,
          } } },
        }]));
      case "/v1/charges/ch_local_fixture":
        return Response.json({ customer: fakeCustomer });
      default: {
        if (path.startsWith("/v1/checkout/sessions/")) {
          const [, , , , id, operation] = path.split("/");
          if (operation === "expire") {
            assert.equal(init?.method, "POST");
            assert.ok(idempotency);
            state.expiredSessions.add(id);
          }
          const expired = state.expiredSessions.has(id);
          return Response.json({
            id, status: expired ? "expired" : state.checkoutStatus,
            url: expired ? null : `https://checkout.stripe.com/c/pay/${id}`,
          });
        }
        throw new Error(`Unexpected fake Stripe URL ${url}`);
      }
    }
  };
  const stripe = createStripeClient(fakeSecret, fakeFetch);
  const deps = {
    getStorage: async () => db.storage, production: false, clock: db.clock, createStripe: () => stripe,
    environment: {
      SITE_URL: site, STRIPE_MCP_SECRET_KEY: fakeSecret, STRIPE_MCP_WEBHOOK_SECRET: fakeWebhook,
      STRIPE_MCP_PRICE_ID_MONTH: monthPrice, STRIPE_MCP_PRICE_ID_YEAR: yearPrice,
    },
  };
  const handlers = createMcpBillingHandlers(deps);
  const request = (route: "checkout" | "portal", locale = "en", headers = {},
    body: object = route === "checkout" ? { locale, interval: "month" } : { locale },
  ) => new Request(`${site}/api/mcp/billing/${route}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { origin: site, cookie, "content-type": "application/json", ...headers },
  });
  const sendEvent = (id: string, type: string, options: { invalid?: boolean; live?: boolean; age?: number; customer?: string; object?: object } = {}) => {
    const payload = JSON.stringify({
      id, type, livemode: options.live ?? false,
      data: { object: { customer: options.customer ?? fakeCustomer, ...options.object } },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload, secret: options.invalid ? "local-bad-secret" : fakeWebhook,
      timestamp: Math.floor(db.clock.now().getTime() / 1000) - (options.age ?? 0),
    });
    return handlers.webhook(new Request(`${site}/api/mcp/billing/webhook`, {
      method: "POST", body: payload, headers: { "stripe-signature": signature },
    }));
  };
  return { db, deps, handlers, request, sendEvent, state, user };
};

test("Checkout and Portal reuse the account and only redirect to Stripe with trusted return URLs", async (t) => {
  const { db, deps, handlers, request, state, user } = await fixture(t);
  assert.equal((await handlers.checkout(request("checkout", "en", { cookie: "" }))).status, 401);
  assert.equal((await handlers.checkout(request("checkout", "en", { origin: "https://external.test" }))).status, 403);
  assert.equal((await handlers.checkout(request("checkout", "xx"))).status, 400);
  for (const body of [{ locale: "en" }, { locale: "en", interval: "week" }]) {
    assert.equal((await handlers.checkout(request("checkout", "en", {}, body))).status, 400);
  }
  assert.equal((await handlers.portal(request("portal", "en", {}, { locale: "en", interval: "year" }))).status, 400);
  assert.equal((await handlers.portal(request("portal"))).status, 404);
  const invalidConfig = createMcpBillingHandlers({
    ...deps, environment: { ...deps.environment, STRIPE_MCP_SECRET_KEY: "invalid-mode-fixture" },
  });
  assert.equal((await invalidConfig.checkout(request("checkout"))).status, 503);
  for (const name of ["STRIPE_MCP_PRICE_ID_MONTH", "STRIPE_MCP_PRICE_ID_YEAR"] as const) {
    const environment: Partial<typeof deps.environment> = { ...deps.environment };
    delete environment[name];
    const incompleteConfig = createMcpBillingHandlers({ ...deps, environment });
    const response = await incompleteConfig.checkout(request("checkout"));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "billing_unavailable");
  }
  assert.equal(state.requests.length, 0);

  const first = await handlers.checkout(request("checkout", "zh"));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  const created = mcpBillingSessionSchema.parse(await first.json());
  assert.match(created.url, /^https:\/\/checkout\.stripe\.com\//);
  const initialCheckout = state.requests.find(({ path }) => path === "/v1/checkout/sessions");
  assert.ok(initialCheckout);
  assert.equal(initialCheckout.fields.get("mode"), "subscription");
  assert.equal(initialCheckout.fields.get("customer"), fakeCustomer);
  assert.equal(initialCheckout.fields.get("line_items[0][price]"), monthPrice);
  assert.equal(initialCheckout.fields.get("success_url"), site + "/zh/dashboard?billing=success");
  assert.equal(initialCheckout.fields.get("cancel_url"), site + "/zh/dashboard?billing=cancel");
  assert.equal((await db.storage.mcpBilling.findAccount({ userId: user.id }))?.customerId, fakeCustomer);

  const repeat = await Promise.all([handlers.checkout(request("checkout")), handlers.checkout(request("checkout", "zh"))]);
  for (const response of repeat) assert.deepEqual(await response.json(), created);
  assert.equal(state.checkoutRequests.size, 1);
  const expires = Number(initialCheckout.fields.get("expires_at")) * 1000;
  db.clock.set(new Date(expires - 1).toISOString());
  assert.deepEqual(await (await handlers.checkout(request("checkout"))).json(), created);
  db.clock.set(new Date(expires).toISOString());
  assert.notDeepEqual(await (await handlers.checkout(request("checkout"))).json(), created);
  assert.equal(state.checkoutRequests.size, 2);

  state.checkoutStatus = "complete";
  state.subscription = "canceled";
  assert.equal((await handlers.checkout(request("checkout"))).status, 200);
  assert.equal(state.checkoutRequests.size, 3, "a settled session can be replaced after cancellation");

  state.subscription = "past_due";
  assert.equal((await handlers.checkout(request("checkout"))).status, 409);
  const portal = await handlers.portal(request("portal"));
  assert.equal(portal.status, 200);
  assert.equal(mcpBillingSessionSchema.parse(await portal.json()).url, "https://billing.stripe.com/p/session/local");
  const last = state.requests.at(-1);
  assert.equal(last?.fields.get("customer"), fakeCustomer);
  assert.equal(last?.fields.get("return_url"), site + "/en/dashboard?billing=portal");
});

for (const recover of [false, true]) {
  test(`switching Checkout from month to year expires the previous link (recover: ${recover})`, async (t) => {
    const { db, handlers, request, state, user } = await fixture(t);
    const monthly = await handlers.checkout(request("checkout"));
    assert.equal(monthly.status, 200);
    const monthlySession = mcpBillingSessionSchema.parse(await monthly.json());
    const month = await db.storage.mcpBilling.findAccount({ userId: user.id });
    assert.equal(month?.checkoutInterval, "month");
    assert.ok(month.checkoutSessionId);
    if (recover) db.raw.prepare("UPDATE mcp_billing_accounts SET checkout_session_id = NULL WHERE user_id = ?").run(user.id);

    const year = () => request("checkout", "zh", {}, { locale: "zh", interval: "year" });
    const yearly = await handlers.checkout(year());
    assert.equal(yearly.status, 200);
    const yearlySession = mcpBillingSessionSchema.parse(await yearly.json());
    assert.notEqual(yearlySession.url, monthlySession.url);
    const checkouts = state.requests.filter(({ path }) => path === "/v1/checkout/sessions");
    assert.deepEqual(checkouts.map(({ fields }) => fields.get("line_items[0][price]")),
      recover ? [monthPrice, monthPrice, yearPrice] : [monthPrice, yearPrice]);
    assert.equal(checkouts.at(-1)?.fields.get("success_url"), site + "/zh/dashboard?billing=success");
    assert.notEqual(checkouts.at(-1)?.idempotency, checkouts[0].idempotency);
    assert.equal(state.checkoutRequests.size, 2);
    assert.deepEqual([...state.expiredSessions], [month.checkoutSessionId]);
    assert.ok(state.requests.findIndex(({ path }) => path.endsWith("/expire")) < state.requests.indexOf(checkouts.at(-1)!));
    assert.deepEqual(await (await handlers.checkout(year())).json(), yearlySession);
    assert.equal(state.checkoutRequests.size, 2);
    assert.equal((await db.storage.mcpBilling.findAccount({ userId: user.id }))?.checkoutInterval, "year");
  });
}

test("signed test events synchronize Stripe state and handle replay, expiry and refunds", async (t) => {
  const { db, handlers, sendEvent, state, user } = await fixture(t);
  await db.storage.mcpBilling.setCustomer(user.id, fakeCustomer);
  const issue = await db.storage.mcp.createKey(user.id, "Retained across plan changes");
  assert.ok(issue);
  const principal = await db.storage.mcp.authenticateKey(issue.key);
  assert.ok(principal);
  const plan = async () => (await db.storage.mcp.getUsage(user.id)).plan;
  const sync = async (id: string, type = "customer.subscription.updated", object?: object) => {
    const response = await sendEvent(id, type, { object });
    assert.equal(response.status, 200);
    mcpBillingWebhookAckSchema.parse(await response.json());
  };

  assert.equal(await plan(), "free");
  assert.equal((await handlers.webhook(new Request(site, { method: "POST", body: "{}" }))).status, 400);
  assert.equal((await sendEvent("evt_bad", "invoice.paid", { invalid: true })).status, 400);
  assert.equal((await sendEvent("evt_live", "invoice.paid", { live: true })).status, 400);
  assert.equal((await sendEvent("evt_old", "invoice.paid", { age: 301 })).status, 400);
  assert.equal((await sendEvent("evt_unknown", "invoice.paid", { customer: "cus_unlinked" })).status, 200);
  assert.equal(state.requests.length, 0);

  state.subscription = "trialing";
  await sync("evt_trial", "customer.subscription.created");
  assert.equal(await plan(), "paid");
  db.clock.set("2026-12-31T23:59:59.999Z");
  assert.equal(await plan(), "paid");
  db.clock.set("2027-01-01T00:00:00.000Z");
  assert.equal(await plan(), "free");

  state.subscription = "active";
  await sync("evt_paid", "invoice.paid");
  assert.equal(await plan(), "paid");
  assert.equal((await db.storage.mcp.reserveCall(principal))?.usage.month.used, 1);
  const requests = state.requests.length;
  await sync("evt_paid", "invoice.paid");
  assert.equal(state.requests.length, requests);
  assert.equal(db.raw.prepare("SELECT count(*) FROM mcp_stripe_events WHERE id = 'evt_paid'").pluck().get(), 1);

  state.subscription = "past_due";
  await sync("evt_late", "invoice.payment_failed");
  assert.equal(await plan(), "free");
  assert.equal((await db.storage.mcp.reserveCall(principal))?.usage.month.used, 2);
  await sync("evt_delivered_out_of_order", "invoice.paid");
  assert.equal(await plan(), "free");
  for (const status of ["unpaid", "incomplete", "incomplete_expired", "paused", "canceled"]) {
    state.subscription = status;
    await sync(`evt_${status}`);
    assert.equal(await plan(), "free");
  }

  state.subscription = "active";
  state.price = "price_another_product";
  await sync("evt_wrong_price", "invoice.paid");
  assert.equal(await plan(), "free");
  state.price = monthPrice;
  state.invoiceStatus = "open";
  await sync("evt_open", "invoice.payment_failed");
  assert.equal(await plan(), "free");
  state.invoiceStatus = "paid";
  await sync("evt_recovered", "invoice.paid");
  assert.equal(await plan(), "paid");
  state.partiallyRefunded = true;
  await sync("evt_partial", "charge.refunded");
  assert.equal(await plan(), "paid");
  state.refunded = true;
  await sync("evt_refunded", "charge.refunded");
  assert.equal(await plan(), "free");
  await sync("evt_old_active", "customer.subscription.updated");
  assert.equal(await plan(), "free");
  state.refunded = false;
  await sync("evt_refund_failed", "refund.failed", { charge: "ch_local_fixture" });
  assert.equal(await plan(), "paid");

  state.cancelAt = trialEnd + 5;
  await sync("evt_cancel_later");
  db.clock.set("2027-01-01T00:00:04.999Z");
  assert.equal(await plan(), "paid");
  db.clock.set("2027-01-01T00:00:05.000Z");
  assert.equal(await plan(), "free");
  assert.deepEqual(await db.storage.mcp.authenticateKey(issue.key), principal);
});

test("signed events grant both Pro prices and keep access after a portal switch", async (t) => {
  const { db, sendEvent, state, user } = await fixture(t);
  await db.storage.mcpBilling.setCustomer(user.id, fakeCustomer);
  state.subscription = "active";
  const syncPrice = async (price: string, end: number) => {
    state.price = price;
    state.periodEnd = end;
    assert.equal((await sendEvent(`evt_${price}`, "customer.subscription.updated")).status, 200);
    const usage = await db.storage.mcp.getUsage(user.id);
    const paidUntil = db.raw.prepare("SELECT paid_until FROM mcp_billing_accounts WHERE user_id = ?").pluck().get(user.id);
    return { plan: usage.plan, paidUntil };
  };
  assert.deepEqual(await syncPrice(monthPrice, currentPeriodEnd), { plan: "paid", paidUntil: currentPeriodEnd });
  const yearlyEnd = Date.parse("2028-01-01T00:00:00Z") / 1000;
  assert.deepEqual(await syncPrice(yearPrice, yearlyEnd), { plan: "paid", paidUntil: yearlyEnd });
  assert.deepEqual(await syncPrice("price_other_fixture", yearlyEnd), { plan: "free", paidUntil: 0 });
});
