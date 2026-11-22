"use client";

import { useEffect, useState } from "react";

import type { McpApiKey, McpBillingReturn, McpUsage } from "@arch-competition/core";

import { McpErrorNotice } from "@/components/mcp-error-notice";
import { McpKeysPanel } from "@/components/mcp-keys-panel";
import { McpPlanBlock } from "@/components/mcp-plan-block";
import { McpUsageMeters } from "@/components/mcp-usage-meters";
import type { AppLocale } from "@/i18n/config";
import type { McpAccountCopy } from "@/i18n/slices";
import { useAuthDialog } from "@/lib/auth-dialog";
import { BILLING_CONFIRM_INTERVAL_MS, billingConfirmStep, withoutBillingParam } from "@/lib/mcp-account";
import { readMcpUsage, type McpFailure } from "@/lib/mcp-requests";

type BillingMessage = "cancel" | "confirming" | "pending" | "portal" | "success";

type McpAccountPanelProps = {
  billingReturn: McpBillingReturn | null;
  connectHref: string;
  copy: McpAccountCopy;
  initialKeys: McpApiKey[];
  initialUsage: McpUsage;
  locale: AppLocale;
  maxActiveKeys: number;
};

/**
 * The AI-access section of the account page. Owns the usage reading, because the plan shown
 * next to it changes when a checkout completes: on `?billing=success` usage is re-read a few
 * times until the webhook has applied the plan, then the page says so either way.
 */
export const McpAccountPanel = ({
  billingReturn, connectHref, copy, initialKeys, initialUsage, locale, maxActiveKeys,
}: McpAccountPanelProps) => {
  const text = copy.account;
  const openAuth = useAuthDialog();
  const [usage, setUsage] = useState(initialUsage);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<McpFailure | null>(null);
  const [billing, setBilling] = useState<BillingMessage | null>(
    billingReturn === "success" ? "confirming" : billingReturn,
  );

  const refresh = async () => {
    setLoading(true);
    setFailure(null);
    const result = await readMcpUsage();
    setLoading(false);
    if (result.ok) setUsage(result.data);
    else setFailure(result.failure);
  };

  useEffect(() => {
    if (!billingReturn) return;
    // The message is shown once; a reload or a shared link should not repeat it.
    window.history.replaceState(window.history.state, "", withoutBillingParam(window.location.href));
    if (billingReturn !== "success") return;
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;
    const poll = async () => {
      const result = await readMcpUsage();
      attempt += 1;
      if (cancelled) return;
      if (result.ok) setUsage(result.data);
      const step = billingConfirmStep(result.ok ? result.data.plan : "free", attempt);
      if (step === "poll") timer = window.setTimeout(() => void poll(), BILLING_CONFIRM_INTERVAL_MS);
      else setBilling(step === "confirmed" ? "success" : "pending");
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [billingReturn]);

  return (
    <section aria-labelledby="mcp-account-title" className="panel mcp-account">
      <div className="panel-header">
        <div>
          <span className="eyebrow">{text.eyebrow}</span>
          <h2 id="mcp-account-title">{text.title}</h2>
        </div>
      </div>

      {billing ? (
        <div className={`mcp-notice${billing === "pending" ? " is-pending" : ""}`} role="status">
          <p>{text.billing[billing]}</p>
          {billing === "confirming" ? null : (
            <button className="button secondary" onClick={() => setBilling(null)} type="button">
              {text.billing.dismiss}
            </button>
          )}
        </div>
      ) : null}

      <div className="mcp-account-grid">
        <McpKeysPanel
          connectHref={connectHref}
          copy={copy}
          initialKeys={initialKeys}
          locale={locale}
          maxActiveKeys={maxActiveKeys}
        />
        <div className="mcp-account-side">
          <McpUsageMeters copy={copy} loading={loading} locale={locale} onRefresh={() => void refresh()} usage={usage} />
          {failure ? (
            <McpErrorNotice
              actions={{
                reload: { label: text.actions.reload, run: () => window.location.reload() },
                retry: { label: text.actions.retry, run: () => void refresh() },
                retryLater: { label: text.actions.retry, run: () => void refresh() },
                ...(openAuth ? { signIn: { label: text.actions.signIn, run: () => openAuth("login") } } : {}),
              }}
              copy={text}
              failure={failure}
            />
          ) : null}
          <McpPlanBlock copy={copy} locale={locale} plan={usage.plan} />
        </div>
      </div>
    </section>
  );
};
