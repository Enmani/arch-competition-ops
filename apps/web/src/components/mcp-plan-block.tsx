"use client";

import { useEffect, useState } from "react";

import { MCP_PLANS, MCP_PRICING, type McpBillingInterval, type McpPlan } from "@arch-competition/core";

import { McpErrorNotice } from "@/components/mcp-error-notice";
import type { AppLocale } from "@/i18n/config";
import { fillTemplate, getIntlLocale } from "@/i18n/format";
import type { McpAccountCopy } from "@/i18n/slices";
import { useAuthDialog } from "@/lib/auth-dialog";
import { annualSavings } from "@/lib/mcp-account";
import { openMcpPortal, startMcpCheckout, type McpFailure } from "@/lib/mcp-requests";

type McpPlanBlockProps = {
  copy: McpAccountCopy;
  locale: AppLocale;
  plan: McpPlan;
};

/** Current plan; on the free plan an upgrade with a monthly/yearly choice, on Pro the portal. */
export const McpPlanBlock = ({ copy, locale, plan }: McpPlanBlockProps) => {
  const text = copy.account.plan;
  const openAuth = useAuthDialog();
  const [interval, setBillingInterval] = useState<McpBillingInterval>("month");
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [failure, setFailure] = useState<McpFailure | null>(null);
  const number = new Intl.NumberFormat(getIntlLocale(locale));
  const money = new Intl.NumberFormat(getIntlLocale(locale), {
    currency: MCP_PRICING.currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  });
  const savings = annualSavings();

  // Coming back from Stripe with the browser's back button restores this page from the
  // back/forward cache with the button still loading; reset it.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const go = async (action: "checkout" | "portal") => {
    if (busy) return;
    setBusy(action);
    setFailure(null);
    const result = action === "checkout" ? await startMcpCheckout(locale, interval) : await openMcpPortal(locale);
    if (result.ok) {
      // Stay in the loading state until the browser leaves for Stripe.
      window.location.assign(result.data.url);
      return;
    }
    setBusy(null);
    setFailure(result.failure);
  };

  const paid = plan === "paid";
  const limits = MCP_PLANS.paid;

  return (
    <section aria-labelledby="mcp-plan-title" className="mcp-block mcp-plan" id="mcp-plan">
      <div className="mcp-block-head">
        <h3 id="mcp-plan-title">{text.title}</h3>
        <span className="mcp-meta">{fillTemplate(text.current, { plan: copy.plans[plan] })}</span>
      </div>

      {paid ? (
        <button
          aria-busy={busy === "portal"}
          className="button secondary"
          disabled={busy !== null}
          onClick={() => void go("portal")}
          type="button"
        >
          {busy === "portal" ? text.opening : text.manage}
        </button>
      ) : (
        <div className="mcp-upgrade">
          <p className="mcp-upgrade-title">
            <strong>{text.proTitle}</strong>{" "}
            <span>
              {fillTemplate(copy.quota.pair, {
                minute: fillTemplate(copy.quota.perMinute, { count: number.format(limits.minuteLimit) }),
                month: fillTemplate(copy.quota.perMonth, { count: number.format(limits.monthlyLimit) }),
              })}
            </span>
          </p>
          <fieldset className="mcp-interval">
            <legend className="sr-only">{text.intervalLabel}</legend>
            {(["month", "year"] as const).map((option) => (
              <label className={interval === option ? "is-selected" : undefined} key={option}>
                <input
                  checked={interval === option}
                  name="mcp-interval"
                  onChange={() => setBillingInterval(option)}
                  type="radio"
                  value={option}
                />
                <span>{text[option]}</span>
              </label>
            ))}
          </fieldset>
          <p className="mcp-price">
            {fillTemplate(interval === "month" ? text.perMonth : text.perYear, {
              amount: money.format(MCP_PRICING[interval]),
            })}
          </p>
          {savings.amount > 0 ? (
            <p className="mcp-note">
              {fillTemplate(text.saving, { amount: money.format(savings.amount), percent: savings.percent })}
            </p>
          ) : null}
          <button
            aria-busy={busy === "checkout"}
            className="button primary"
            disabled={busy !== null}
            onClick={() => void go("checkout")}
            type="button"
          >
            {busy === "checkout" ? text.redirecting : text.upgrade}
          </button>
          <p className="mcp-note">{text.stripe}</p>
        </div>
      )}

      {failure ? (
        <McpErrorNotice
          actions={{
            openPortal: { label: text.manage, run: () => void go("portal") },
            reload: { label: copy.account.actions.reload, run: () => window.location.reload() },
            retry: { label: copy.account.actions.retry, run: () => void go(paid ? "portal" : "checkout") },
            retryLater: { label: copy.account.actions.retry, run: () => void go(paid ? "portal" : "checkout") },
            ...(openAuth ? { signIn: { label: copy.account.actions.signIn, run: () => openAuth("login") } } : {}),
          }}
          copy={copy.account}
          failure={failure}
        />
      ) : null}
    </section>
  );
};
