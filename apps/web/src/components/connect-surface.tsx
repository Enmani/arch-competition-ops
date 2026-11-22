"use client";

import Link from "next/link";
import { useState } from "react";

import { MCP_PLANS, type McpApiKey } from "@arch-competition/core";

import { ConnectClients } from "@/components/connect-clients";
import { ConnectKeyStrip } from "@/components/connect-key-strip";
import { CopyButton } from "@/components/mcp-snippet";
import type { AppLocale } from "@/i18n/config";
import { fillTemplate, getIntlLocale } from "@/i18n/format";
import type { ConnectCopy } from "@/i18n/slices";

type ConnectSurfaceProps = {
  accountHref: string;
  copy: ConnectCopy;
  endpoint: string;
  initialKeys: McpApiKey[] | null;
  locale: AppLocale;
  maxActiveKeys: number;
  pricingHref: string;
  registerHref: string;
};

/** The public connect page: address first, then the client tabs, then questions to try. */
export const ConnectSurface = ({
  accountHref, copy, endpoint, initialKeys, locale, maxActiveKeys, pricingHref, registerHref,
}: ConnectSurfaceProps) => {
  const [keyValue, setKeyValue] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const text = copy.connect;
  const number = new Intl.NumberFormat(getIntlLocale(locale));
  const limits = (plan: keyof typeof MCP_PLANS) => ({
    minute: fillTemplate(copy.quota.perMinute, { count: number.format(MCP_PLANS[plan].minuteLimit) }),
    month: fillTemplate(copy.quota.perMonth, { count: number.format(MCP_PLANS[plan].monthlyLimit) }),
  });

  return (
    <main className="mcp-page">
      <header className="mcp-intro">
        <span className="eyebrow">{text.eyebrow}</span>
        <h1>{text.title}</h1>
        <p>{text.lede}</p>
      </header>

      <div className="mcp-endpoint">
        <span className="mcp-endpoint-label" id="mcp-endpoint-label">
          {text.urlLabel}
        </span>
        <code aria-labelledby="mcp-endpoint-label" className="mcp-endpoint-url">
          {endpoint}
        </code>
        <CopyButton copy={copy.copy} label={text.urlLabel} primary value={endpoint} />
      </div>

      <p className="mcp-quota">
        {fillTemplate(text.anonymousQuota, limits("anonymous"))} {fillTemplate(text.keyQuota, limits("free"))}{" "}
        <Link className="inline-link" href={pricingHref}>
          {text.links.pricing}
        </Link>
      </p>

      <ConnectKeyStrip
        accountHref={accountHref}
        copy={copy}
        initialKeys={initialKeys}
        // Remount on sign-in or sign-out so the key list matches the account.
        key={initialKeys === null ? "anonymous" : "signed-in"}
        keyValue={keyValue}
        maxActiveKeys={maxActiveKeys}
        onKeyChange={(key) => {
          setKeyValue(key);
          setRevealed(false);
        }}
        onRevealChange={setRevealed}
        registerHref={registerHref}
        revealed={revealed}
      />

      <ConnectClients copy={copy} endpoint={endpoint} keyValue={keyValue} revealed={revealed} />

      <section aria-labelledby="mcp-examples-title" className="mcp-examples">
        <h2 id="mcp-examples-title">{text.examples.title}</h2>
        <ul>
          {text.examples.items.map((item) => (
            <li key={item}>
              <span>{item}</span>
              <CopyButton copy={copy.copy} value={item} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
};
