import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { MCP_MAX_ACTIVE_KEYS, MCP_PLANS, MCP_PRICING } from "@arch-competition/core";
import { SESSION_LIFETIME_MS } from "@arch-competition/storage";

import { localeCookieName, locales } from "../i18n/config";
import { dictionaries } from "../i18n/dictionaries";
import { fillSections, legalPlanRows, legalValues, PLAN_TIERS } from "./legal-content";
import { COOKIES_PATH, LEGAL_LINKS } from "./legal-links";
import { OPERATOR } from "./operator";
import { SESSION_COOKIE_MAX_AGE_SECONDS, serializeSessionCookie, sessionCookieName } from "./session-cookie";
import { SITE_STORAGE } from "./site-storage";
import { SUPPORT_LINKS } from "./support-links";
import { THEME_STORAGE_KEY } from "./theme";

const appDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "[locale]");
const pageExists = (href: string) => fs.existsSync(path.join(appDirectory, href.split("#")[0], "page.tsx"));

const longPages = (locale: (typeof locales)[number]) => {
  const { about, legal } = dictionaries[locale];
  return { about, privacy: legal.privacy, refund: legal.refund, terms: legal.terms };
};

test("every legal link and the cookie link lead to a page that exists", () => {
  for (const link of LEGAL_LINKS) {
    assert.ok(pageExists(link.href), `${link.href} has no page under app/[locale]`);
  }
  assert.ok(pageExists("/about"));
  const anchor = COOKIES_PATH.split("#")[1];
  for (const locale of locales) {
    assert.ok(dictionaries[locale].about.sections.some((section) => section.id === anchor), `${locale} About has no #${anchor}`);
  }
});

test("each English legal page has the same sections, paragraphs and items as the Chinese one", () => {
  const zh = longPages("zh");
  const en = longPages("en");
  for (const page of Object.keys(zh) as (keyof typeof zh)[]) {
    const shape = (copy: typeof zh.terms) =>
      copy.sections.map((section) => `${section.id}:${section.paragraphs.length}:${section.items.length}`);
    assert.deepEqual(shape(en[page]), shape(zh[page]), `${page} differs between en and zh`);
  }
});

test("every placeholder in the legal and About copy is filled from code", () => {
  for (const locale of locales) {
    const values = legalValues(locale);
    for (const [page, copy] of Object.entries(longPages(locale))) {
      for (const section of fillSections(copy.sections, values)) {
        for (const text of [...section.paragraphs, ...section.items]) {
          assert.doesNotMatch(text, /\{\w+\}/, `${locale}:${page}#${section.id} keeps a placeholder: ${text}`);
        }
      }
    }
  }
});

test("the Terms plan table is built from MCP_PLANS and MCP_PRICING", () => {
  for (const locale of locales) {
    const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-GB");
    const rows = legalPlanRows(locale, dictionaries[locale].mcp);
    assert.deepEqual(rows.map((row) => row.tier), [...PLAN_TIERS]);
    for (const row of rows) {
      assert.equal(row.month, number.format(MCP_PLANS[row.tier].monthlyLimit));
      assert.equal(row.minute, number.format(MCP_PLANS[row.tier].minuteLimit));
    }
    const pro = rows.find((row) => row.tier === "paid")!;
    for (const amount of [MCP_PRICING.month, MCP_PRICING.year]) {
      assert.match(pro.price, new RegExp(`${amount}`), `${locale} Pro price lacks ${amount}`);
    }
  }
});

test("the Terms copy states no quota or price of its own, so it cannot drift from the code", () => {
  const numbers = [
    ...Object.values(MCP_PLANS).flatMap((plan) => [plan.monthlyLimit, plan.minuteLimit]),
    MCP_PRICING.month,
    MCP_PRICING.year,
    MCP_MAX_ACTIVE_KEYS,
  ].map(String);
  for (const locale of locales) {
    const copy = dictionaries[locale].legal.terms;
    const text = copy.sections.flatMap((section) => [...section.paragraphs, ...section.items]).join("\n");
    for (const value of numbers) {
      assert.doesNotMatch(text, new RegExp(`(^|[^\\d{])${value}([^\\d}]|$)`), `${locale} terms hard-code ${value}`);
    }
  }
});

test("the operator's contact is the support email and unset optional fields stay null", () => {
  const mail = SUPPORT_LINKS.find((link) => link.href.startsWith("mailto:"));
  assert.equal(`mailto:${OPERATOR.contactEmail}`, mail?.href);
  assert.equal(OPERATOR.name, "Enmani");
  assert.match(OPERATOR.governingLaw, /^[A-Z]{2}$/);
  for (const field of [OPERATOR.address, OPERATOR.taxId, OPERATOR.country]) {
    assert.ok(field === null || field.trim() !== "", "an optional field is either null or a real value");
  }
});

test("the cookie table matches the cookies and storage the code writes", () => {
  assert.deepEqual(SITE_STORAGE.map((item) => item.name), [sessionCookieName(true), localeCookieName, THEME_STORAGE_KEY]);
  const session = SITE_STORAGE.find((item) => item.id === "session")!;
  const header = serializeSessionCookie("token", new Date(Date.now() + SESSION_LIFETIME_MS).toISOString(), true);
  for (const flag of session.flags) {
    assert.ok(header.split("; ").includes(flag), `session cookie lacks ${flag}`);
  }
  assert.equal(session.maxAgeSeconds, SESSION_LIFETIME_MS / 1000, "cookie lifetime and session lifetime agree");
  assert.equal(SESSION_COOKIE_MAX_AGE_SECONDS, SESSION_LIFETIME_MS / 1000);
  const locale = SITE_STORAGE.find((item) => item.id === "locale")!;
  assert.ok(!locale.flags.includes("HttpOnly"), "the language cookie must stay clearable from the About page");
  assert.equal(legalValues("en").sessionDays, SESSION_LIFETIME_MS / 86_400_000);
});
