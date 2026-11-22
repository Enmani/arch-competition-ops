import Stripe from "stripe";

export const createStripeClient = (secret: string, fetchImpl?: typeof fetch) => new Stripe(secret, {
  httpClient: Stripe.createFetchHttpClient(fetchImpl),
  timeout: 10_000,
  maxNetworkRetries: 1,
});

export const stripeObjectId = (object: string | { id: string } | null | undefined) =>
  typeof object === "string" ? object : object?.id;

export const checkoutHasSubscription = async (stripe: Stripe, customer: string) => {
  for await (const subscription of stripe.subscriptions.list({ customer, status: "all", limit: 20 })) {
    if (subscription.status !== "canceled" && subscription.status !== "incomplete_expired") return true;
  }
  return false;
};

const latestSubscription = async (stripe: Stripe, customer: string, priceIds: readonly string[]) => {
  for await (const subscription of stripe.subscriptions.list({ customer, status: "all", limit: 20 })) {
    const item = subscription.items.data.find(({ price }) => priceIds.includes(price.id));
    if (item) return { subscription, item };
  }
  return null;
};

const fullyRefunded = async (stripe: Stripe, invoiceId: string) => {
  const payments = stripe.invoicePayments.list({
    invoice: invoiceId,
    status: "paid",
    limit: 20,
    expand: ["data.payment.charge", "data.payment.payment_intent.latest_charge"],
  });
  let refunded = false;
  for await (const { payment, amount_paid: paid } of payments) {
    if (!paid) continue;
    const intent = payment.payment_intent;
    const charge = payment.charge ?? (typeof intent === "object" ? intent.latest_charge : null);
    if (typeof charge !== "object" || !charge?.refunded) return false;
    refunded = true;
  }
  return refunded;
};

/** Re-read Stripe state on every relevant event. Arrival order never defines entitlement. */
export const stripePaidUntil = async (stripe: Stripe, customer: string, priceIds: readonly string[]) => {
  const match = await latestSubscription(stripe, customer, priceIds);
  if (!match) return 0;
  const { subscription, item } = match;
  const periodEnd = Math.min(item.current_period_end, subscription.cancel_at ?? Infinity);
  if (subscription.status === "trialing") return Math.min(periodEnd, subscription.trial_end ?? 0);
  if (subscription.status !== "active" || subscription.pause_collection) return 0;
  const invoiceId = stripeObjectId(subscription.latest_invoice);
  if (!invoiceId) return 0;
  const invoice = await stripe.invoices.retrieve(invoiceId);
  if (invoice.status !== "paid") return 0;
  if (invoice.amount_paid > 0 && await fullyRefunded(stripe, invoice.id)) return 0;
  return periodEnd;
};

export const stripeCustomerForEvent = async (stripe: Stripe, event: Stripe.Event) => {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.voided":
    case "invoice.marked_uncollectible":
    case "charge.refunded":
      return stripeObjectId(event.data.object.customer);
    case "refund.updated":
    case "refund.failed": {
      const chargeId = stripeObjectId(event.data.object.charge);
      if (!chargeId) return undefined;
      return stripeObjectId((await stripe.charges.retrieve(chargeId)).customer);
    }
    default:
      return undefined;
  }
};
