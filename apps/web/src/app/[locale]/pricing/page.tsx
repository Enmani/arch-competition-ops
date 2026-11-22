import type { Metadata } from "next";
import Link from "next/link";

import { MCP_PLANS, MCP_PRICING, type McpPlan } from "@arch-competition/core";

import { buildLocalePath, type AppLocale } from "@/i18n/config";
import { fillTemplate, getIntlLocale } from "@/i18n/format";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { getCurrentAuthUser } from "@/lib/auth";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { annualSavings } from "@/lib/mcp-account";
import { buildPageMetadata } from "@/lib/page-metadata";
import { getStorage } from "@/lib/server-storage";

export const dynamic = "force-dynamic";

type PricingPageProps = { params: Promise<{ locale: string }> };

export const generateMetadata = async ({ params }: PricingPageProps): Promise<Metadata> =>
  buildPageMetadata(resolveLocaleOrNotFound((await params).locale), "pricing", "/pricing");

const TIERS = ["anonymous", "free", "paid"] as const satisfies readonly McpPlan[];

/** Where each tier's button leads; signing up returns to the step that comes next. */
const tierAction = (locale: AppLocale, tier: McpPlan, plan: McpPlan | null) => {
  const path = (value: string) => buildLocalePath(locale, value);
  const register = (next: string) => `${path("/register")}?next=${encodeURIComponent(path(next))}`;
  if (tier === "anonymous") return { href: path("/connect"), key: "connect" } as const;
  if (tier === "free") {
    return plan === null ? ({ href: register("/connect"), key: "getKey" } as const) : ({ href: `${path("/dashboard")}#mcp-keys`, key: "openKeys" } as const);
  }
  if (plan === "paid") return null;
  return { href: plan === null ? register("/dashboard#mcp-plan") : `${path("/dashboard")}#mcp-plan`, key: "upgrade" } as const;
};

const PricingPage = async ({ params }: PricingPageProps) => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  const dictionary = getDictionary(locale);
  const text = dictionary.mcp.pricing;
  const user = await getCurrentAuthUser();
  const plan = user ? (await (await getStorage()).mcp.getUsage(user.id)).plan : null;
  const number = new Intl.NumberFormat(getIntlLocale(locale));
  const money = new Intl.NumberFormat(getIntlLocale(locale), {
    currency: MCP_PRICING.currency, maximumFractionDigits: 2, minimumFractionDigits: 0, style: "currency",
  });
  const savings = annualSavings();
  const legal = LEGAL_LINKS.filter((link): link is { href: string; id: typeof link.id } => link.href !== null);

  return (
    <main className="mcp-page pricing-page">
      <header className="mcp-intro">
        <span className="eyebrow">{text.eyebrow}</span>
        <h1>{text.title}</h1>
        <p>{text.lede}</p>
      </header>

      <ol aria-label={text.title} className="pricing-tiers">
        {TIERS.map((tier) => {
          const action = tierAction(locale, tier, plan);
          const current = plan === tier;
          return (
            <li className={`pricing-tier${tier === "paid" ? " is-pro" : ""}`} key={tier}>
              <h2>{dictionary.mcp.plans[tier]}</h2>
              <dl>
                <div>
                  <dt>{text.columns.month}</dt>
                  <dd>{number.format(MCP_PLANS[tier].monthlyLimit)}</dd>
                </div>
                <div>
                  <dt>{text.columns.minute}</dt>
                  <dd>{number.format(MCP_PLANS[tier].minuteLimit)}</dd>
                </div>
                <div>
                  <dt>{text.columns.price}</dt>
                  <dd>
                    {tier === "paid" ? (
                      <>
                        {fillTemplate(dictionary.mcp.quota.monthly, { amount: money.format(MCP_PRICING.month) })}
                        <br />
                        {fillTemplate(dictionary.mcp.quota.yearly, { amount: money.format(MCP_PRICING.year) })}
                        {savings.amount > 0 ? (
                          <span className="pricing-saving">
                            {fillTemplate(dictionary.mcp.account.plan.saving, {
                              amount: money.format(savings.amount),
                              percent: savings.percent,
                            })}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      text.free
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{text.columns.access}</dt>
                  <dd>{text.access[tier]}</dd>
                </div>
              </dl>
              {current ? (
                <span className="pricing-current">{text.actions.current}</span>
              ) : action ? (
                <Link className={`button ${tier === "paid" ? "primary" : "secondary"}`} href={action.href}>
                  {text.actions[action.key]}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="pricing-notes">
        <p>{text.counted}</p>
        <p>{text.billing}</p>
      </div>

      {legal.length > 0 ? (
        <nav aria-label={text.legal.label} className="pricing-legal">
          {legal.map((link) => (
            <a className="inline-link" href={link.href} key={link.id}>
              {text.legal[link.id]}
            </a>
          ))}
        </nav>
      ) : null}
    </main>
  );
};

export default PricingPage;
