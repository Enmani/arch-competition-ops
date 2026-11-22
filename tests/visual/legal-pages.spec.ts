// About, Terms, Privacy and Refund pages, the footer line and the sign-up consent line, in a real
// browser at 1280 and 390 px. Screenshots (light and dark) go to artifacts/visual/legal for review.
// The discover page must keep no footer and the same layout: its structure is compared with a
// signature recorded before the footer existed (artifacts/visual/legal/discover-baseline.json,
// taken from the local database at commit 804a6b6); the check is skipped when that file is absent.
// The widths are set here, so only the "desktop" project runs this file.
import fs from "node:fs";

import { expect, test, type Page } from "@playwright/test";

const SHOTS = "artifacts/visual/legal";
const BASELINE = `${SHOTS}/discover-baseline.json`;
const LOCALES = ["en", "zh"] as const;
const PAGES = ["about", "terms", "privacy", "refund", "pricing", "register"] as const;
const WIDTHS = [1280, 390] as const;

// Any console error (hydration mismatch, failed render) fails the test that caused it.
const consoleErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "widths are set per test");
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
});

test.afterEach(({ page }) => {
  expect(consoleErrors.get(page) ?? []).toEqual([]);
});

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const shoot = async (page: Page, name: string) => {
  await page.waitForLoadState("networkidle");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ animations: "disabled", caret: "initial", fullPage: true, path: `${SHOTS}/${name}-${colorScheme}.png` });
  }
  await page.emulateMedia({ colorScheme: null });
};

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const locale of LOCALES) {
      for (const name of PAGES) {
        test(`/${locale}/${name} has the footer, no sideways scroll, and text that fits`, async ({ page }) => {
          await page.goto(`/${locale}/${name}`);
          const footer = page.locator("footer.site-footer");
          await expect(footer).toBeVisible();
          // Footer: About, the three legal pages and the cookie section, all localised.
          const hrefs = await footer.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
          expect(hrefs).toEqual([`/${locale}/about`, `/${locale}/terms`, `/${locale}/privacy`, `/${locale}/refund`, `/${locale}/about#cookies`]);
          expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
          // No element of the reading column may stick out of it (long words, tables, codes).
          const spills = await page.evaluate(() => {
            const main = document.querySelector("main");
            if (!main) return ["no main"];
            const box = main.getBoundingClientRect();
            return [...main.querySelectorAll("p, li, h1, h2, table, dl, code, a")]
              .filter((element) => !element.closest(".legal-table-wrap"))
              .filter((element) => element.getBoundingClientRect().right > box.right + 1)
              .map((element) => `${element.tagName}.${element.className}`);
          });
          expect(spills).toEqual([]);
          await shoot(page, `${width}-${locale}-${name}`);
        });
      }

      test(`/${locale}/discover has no footer and the layout of the baseline`, async ({ page }) => {
        await page.goto(`/${locale}/discover`);
        await page.waitForSelector(".opportunity-tile");
        await page.waitForLoadState("networkidle");
        expect(await page.locator("footer, .site-footer").count()).toBe(0);
        test.skip(locale !== "en" || !fs.existsSync(BASELINE), "baseline recorded for /en/discover only");
        const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"))[String(width)];
        const now = await page.evaluate(() => {
          const main = document.querySelector("#main-content")!;
          const shape: string[] = [];
          const walk = (node: Element, depth: number) => {
            if (depth > 6) return;
            for (const child of node.children) {
              shape.push(`${"  ".repeat(depth)}${child.tagName.toLowerCase()}.${[...child.classList].sort().join(".")}`);
              walk(child, depth + 1);
            }
          };
          walk(main, 0);
          const rect = (element: Element | null) => {
            if (!element) return null;
            const box = element.getBoundingClientRect();
            return [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)];
          };
          return {
            firstTile: rect(document.querySelector(".opportunity-tile")),
            main: rect(main),
            shape: shape.slice(0, 400),
            topbar: rect(document.querySelector(".topbar")),
          };
        });
        expect(now.shape).toEqual(baseline.shape);
        expect(now.topbar).toEqual(baseline.topbar);
        expect(now.main).toEqual(baseline.main);
        expect(now.firstTile).toEqual(baseline.firstTile);
      });
    }
  });
}

test.describe("consent and preferences", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the register page names the Terms and the Privacy notice as keyboard-reachable links", async ({ page }) => {
    await page.goto("/en/register");
    const consent = page.locator(".auth-consent");
    await expect(consent).toHaveText("By creating an account you agree to the Terms and the Privacy notice.");
    await expect(consent.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/en/terms");
    await expect(consent.getByRole("link", { name: "Privacy notice" })).toHaveAttribute("href", "/en/privacy");
    await page.locator("#register-password-confirmation").focus();
    await page.keyboard.press("Tab");
    await expect(consent.getByRole("link", { name: "Terms" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/terms$/);
  });

  test("the sign-up dialog shows the consent line, and following a link closes the dialog", async ({ page }) => {
    await page.goto("/zh/pricing");
    await page.waitForLoadState("networkidle");
    await page.locator(".utility-row").getByRole("link", { name: "登录" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.locator(".auth-secondary button").click();
    const consent = dialog.locator(".auth-consent");
    await expect(consent).toHaveText("创建账号即表示你同意服务条款和隐私说明。");
    await page.screenshot({ path: `${SHOTS}/1280-zh-auth-dialog-register-light.png` });
    await consent.getByRole("link", { name: "隐私说明" }).click();
    await expect(page).toHaveURL(/\/zh\/privacy$/);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  });

  test("Reset saved preferences clears language and theme but keeps the session cookie", async ({ context, page }) => {
    await context.addCookies([
      { httpOnly: true, name: "arch_competition_ops_session", sameSite: "Lax", url: "http://localhost:3400", value: "kept" },
    ]);
    await page.goto("/en/about#cookies");
    await page.evaluate(() => localStorage.setItem("theme", "dark"));
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect((await context.cookies()).map((cookie) => cookie.name)).toContain("arch_competition_ops_locale");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByRole("button", { name: "Reset saved preferences" }).click();
    await expect(page.getByRole("status")).toContainText("Done.");
    const names = (await context.cookies()).map((cookie) => cookie.name);
    expect(names).not.toContain("arch_competition_ops_locale");
    expect(names).toContain("arch_competition_ops_session");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    await expect(page.locator(".theme-toggle")).toHaveAttribute("aria-label", "Appearance: Match system");
  });

  test("the cookie table lists exactly the names the code sets", async ({ page }) => {
    await page.goto("/en/about");
    const names = await page.locator(".legal-cookie-table tbody code").allTextContents();
    expect(names).toEqual(["__Host-arch_competition_ops_session", "arch_competition_ops_locale", "theme"]);
  });
});
