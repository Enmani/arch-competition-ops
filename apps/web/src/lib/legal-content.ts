import { MCP_MAX_ACTIVE_KEYS, MCP_PLANS, MCP_PRICING, type McpPlan } from "@arch-competition/core";

import type { AppLocale } from "../i18n/config";
import type { AppDictionary } from "../i18n/dictionaries";
import type { LegalSection } from "../i18n/dictionaries/legal-section";
import { fillTemplate, formatLocalizedDate, getIntlLocale } from "../i18n/format";

import { OPERATOR } from "./operator";
import { SESSION_COOKIE_MAX_AGE_SECONDS } from "./session-cookie";

/** The date shown as "last updated" on the Terms, Privacy and Refund pages. Change it with the text. */
export const LEGAL_UPDATED_AT = "2026-11-22";

const DAY_SECONDS = 24 * 60 * 60;

/** A country code (ISO 3166-1 alpha-2) as a name in the page language, e.g. "IT" -> "Italy" / "意大利". */
export const countryName = (locale: AppLocale, code: string) =>
  new Intl.DisplayNames([getIntlLocale(locale)], { type: "region" }).of(code) ?? code;

/** Values for the `{name}`-style placeholders of the legal and About pages, all read from code. */
export const legalValues = (locale: AppLocale) => ({
  country: countryName(locale, OPERATOR.governingLaw),
  email: OPERATOR.contactEmail,
  maxKeys: MCP_MAX_ACTIVE_KEYS,
  name: OPERATOR.name,
  sessionDays: Math.round(SESSION_COOKIE_MAX_AGE_SECONDS / DAY_SECONDS),
});

export const fillSections = (sections: readonly LegalSection[], values: Record<string, string | number>) =>
  sections.map((section) => ({
    ...section,
    items: section.items.map((item) => fillTemplate(item, values)),
    paragraphs: section.paragraphs.map((paragraph) => fillTemplate(paragraph, values)),
  }));

export const formatLegalUpdated = (locale: AppLocale, template: string) =>
  fillTemplate(template, {
    date: formatLocalizedDate(locale, LEGAL_UPDATED_AT, { day: "numeric", month: "long", year: "numeric" }) ?? LEGAL_UPDATED_AT,
  });

export const PLAN_TIERS = ["anonymous", "free", "paid"] as const satisfies readonly McpPlan[];

export type LegalPlanRow = { minute: string; month: string; name: string; price: string; tier: McpPlan };

/** The plan table of the Terms page, from the same constants as the pricing page and the quota code. */
export const legalPlanRows = (locale: AppLocale, mcp: AppDictionary["mcp"]): LegalPlanRow[] => {
  const number = new Intl.NumberFormat(getIntlLocale(locale));
  const money = new Intl.NumberFormat(getIntlLocale(locale), {
    currency: MCP_PRICING.currency, maximumFractionDigits: 2, minimumFractionDigits: 0, style: "currency",
  });
  return PLAN_TIERS.map((tier) => ({
    minute: number.format(MCP_PLANS[tier].minuteLimit),
    month: number.format(MCP_PLANS[tier].monthlyLimit),
    name: mcp.plans[tier],
    price:
      tier === "paid"
        ? [
            fillTemplate(mcp.quota.monthly, { amount: money.format(MCP_PRICING.month) }),
            fillTemplate(mcp.quota.yearly, { amount: money.format(MCP_PRICING.year) }),
          ].join(" · ")
        : mcp.pricing.free,
    tier,
  }));
};
