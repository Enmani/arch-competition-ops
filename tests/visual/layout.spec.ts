// Layout invariants that a screenshot review keeps missing: nothing may spill out of its tile, the
// page may not scroll sideways, and the filter panel may not move the results. They run on whatever
// records the local database holds, so any record with an unusually long title, place or value is
// covered the day it is ingested. Screenshots go to artifacts/visual for a human look.
import { expect, test, type Page } from "@playwright/test";

const LOCALES = ["en", "zh"] as const;

const gotoDiscover = async (page: Page, locale: string) => {
  await page.goto(`/${locale}/discover`);
  await page.waitForSelector(".opportunity-tile");
  // Controls must be hydrated before a test drives them, or a change event would be lost.
  await page.waitForLoadState("networkidle");
  // Tiles fade in; wait for the entry transition so geometry is final.
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".opportunity-tile")].every((tile) => getComputedStyle(tile).opacity === "1"),
  );
};

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const locale of LOCALES) {
  test.describe(`discover (${locale})`, () => {
    test("the page does not scroll sideways", async ({ page }) => {
      await gotoDiscover(page, locale);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("nothing spills out of its tile", async ({ page }) => {
      await gotoDiscover(page, locale);
      const spills = await page.evaluate(() => {
        const found: string[] = [];
        for (const tile of document.querySelectorAll(".opportunity-tile")) {
          const box = tile.getBoundingClientRect();
          for (const element of tile.querySelectorAll("*")) {
            if (element.closest(".opportunity-media")) continue; // the image is clipped by design
            const rect = element.getBoundingClientRect();
            if (rect.width === 0) continue;
            if (rect.left < box.left - 1 || rect.right > box.right + 1) {
              found.push(`${element.className || element.tagName}: ${Math.round(rect.right - box.right)}px`);
            }
          }
        }
        return found;
      });
      expect(spills).toEqual([]);
    });

    test("tiles in one row share their rules and sit on the same grid lines", async ({ page }) => {
      await gotoDiscover(page, locale);
      const rows = await page.evaluate(() => {
        const byRow = new Map<number, number[]>();
        for (const tile of document.querySelectorAll(".opportunity-tile")) {
          const top = Math.round(tile.getBoundingClientRect().top);
          const rule = tile.querySelector(".opportunity-meta-strip")!.getBoundingClientRect().top;
          byRow.set(top, [...(byRow.get(top) ?? []), Math.round(rule)]);
        }
        return [...byRow.values()];
      });
      for (const rules of rows) expect(new Set(rules).size).toBe(1);
    });

    test("every card title is shown in full or clamped to two lines", async ({ page }) => {
      await gotoDiscover(page, locale);
      const tooTall = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".opportunity-tile-title")]
          .filter((title) => title.getBoundingClientRect().height > parseFloat(getComputedStyle(title).lineHeight) * 2 + 1)
          .map((title) => title.textContent),
      );
      expect(tooTall).toEqual([]);
    });
  });
}

test.describe("filter pills", () => {
  test("a pill opens its panel over the results without moving them", async ({ page }) => {
    await gotoDiscover(page, "en");
    const firstTile = page.locator(".opportunity-tile").first();
    const before = await firstTile.boundingBox();

    await page.locator(".dock-pill-summary").first().click();
    const panel = page.locator(".dock-pill[open] .dock-panel");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await firstTile.boundingBox()).toEqual(before);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `artifacts/visual/filter-panel-${test.info().project.name}.png`, clip: { x: 0, y: 0, width: viewport.width, height: 520 } });
  });

  test("only one panel is open, and a click elsewhere or Escape closes it", async ({ page }) => {
    await gotoDiscover(page, "en");
    const summaries = page.locator(".dock-pill-summary");
    await summaries.nth(0).click();
    await summaries.nth(1).click();
    await expect(page.locator(".dock-pill[open]")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(page.locator(".dock-pill[open]")).toHaveCount(0);

    await summaries.nth(0).click();
    await page.locator(".topbar-search input").click();
    await expect(page.locator(".dock-pill[open]")).toHaveCount(0);
  });

  test("an option shows its checkbox on hover, keeps it once selected, and applies by itself", async ({ page, hasTouch }) => {
    await gotoDiscover(page, "en");
    await page.locator(".dock-pill-summary").first().click();
    const option = page.locator(".dock-pill[open] .dock-option").first();
    const box = option.locator("input");

    if (!hasTouch) {
      await page.mouse.move(0, 0);
      await expect(box).toHaveCSS("opacity", "0");
      await option.hover();
      await expect(box).toHaveCSS("opacity", "1");
    }

    await option.click();
    await expect(page).toHaveURL(/projectType=/);
    // The panel stays open after the filter applied, with the choice kept and counted on the pill.
    await expect(page.locator(".dock-pill[open] .dock-option input:checked")).toHaveCount(1);
    await expect(page.locator(".dock-pill.is-active .dock-count").first()).toHaveText("1");

    await page.mouse.move(0, 0);
    await expect(page.locator(".dock-pill[open] .dock-option input:checked")).toHaveCSS("opacity", "1");
  });

  test("country and sort apply without an extra click", async ({ page }) => {
    await gotoDiscover(page, "en");
    await page.locator("select[name=sort]").selectOption("latest");
    await expect(page).toHaveURL(/sort=latest/);
  });
});

test("clicking a filter pill twice quickly does not select text", async ({ page }) => {
  await gotoDiscover(page, "en");
  const box = (await page.locator(".dock-pill-summary").first().boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
});

test("the watch control is reachable and labelled", async ({ page }) => {
  await gotoDiscover(page, "en");
  const control = page.locator(".opportunity-tile-actions a, .opportunity-tile-actions button").first();
  await expect(control).toHaveAttribute("aria-label", /.+/);
  // Hover-less devices always show it; on hover devices it appears with the tile.
  await page.locator(".opportunity-tile").first().hover();
  await expect(control).toBeVisible();
  expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(40);
});

test("detail page keeps its title and facts inside the page", async ({ page }) => {
  await gotoDiscover(page, "en");
  await page.locator(".opportunity-tile-link").first().click();
  await page.waitForSelector(".detail-hero h1");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ fullPage: true, path: `artifacts/visual/detail-${test.info().project.name}.png` });
});

test("discover screenshot for review", async ({ page }) => {
  await gotoDiscover(page, "en");
  await page.screenshot({ path: `artifacts/visual/discover-${test.info().project.name}.png` });
});

test("search lives in the top bar and the filter is a single row", async ({ page }) => {
  await gotoDiscover(page, "en");
  const bar = (await page.locator(".topbar").boundingBox())!;
  const search = (await page.locator(".topbar-search").boundingBox())!;
  expect(search.y).toBeGreaterThanOrEqual(bar.y);
  expect(search.y + search.height).toBeLessThanOrEqual(bar.y + bar.height + 1);

  // Every control of the dock shares one line (desktop); on narrow screens the row scrolls sideways.
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll(".dock-pills > *")].map((element) => Math.round(element.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);

  await page.locator(".topbar-search input").fill("school");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/search=school/);
});

test("the deadline calendar follows the page language and applies a range", async ({ page }) => {
  await gotoDiscover(page, "zh");
  await page.locator(".dock-pill-summary").filter({ hasText: "日期" }).click();
  // The month caption is rendered by the page's locale, whatever language the browser is set to.
  await expect(page.locator(".dock-calendar .rdp-month_caption").first()).toContainText("年");
  const days = page.locator(".dock-calendar .rdp-day_button:not([disabled])");
  await days.nth(10).click();
  await days.nth(17).click();
  await expect(page).toHaveURL(/deadlineAfter=\d{4}-\d{2}-\d{2}/);
  await expect(page).toHaveURL(/deadlineBefore=\d{4}-\d{2}-\d{2}/);
  await expect(page.locator(".dock-range-summary")).toContainText("年");
});

test.describe("a filter change feels continuous", () => {
  test("the form is not rebuilt, so focus and the open panel survive", async ({ page }) => {
    await gotoDiscover(page, "en");
    await page.locator(".dock-pill-summary").first().click();
    await page.evaluate(() => {
      (document.querySelector(".filter-form") as unknown as { __kept: boolean }).__kept = true;
    });
    await page.locator(".dock-pill[open] .dock-option").first().click();
    await expect(page).toHaveURL(/projectType=/);
    await page.waitForFunction(() => document.querySelector(".discover-dock.is-pending") === null);
    expect(await page.evaluate(() => (document.querySelector(".filter-form") as unknown as { __kept?: boolean }).__kept)).toBe(true);
    await expect(page.locator(".dock-pill[open] .dock-option input:checked")).toHaveCount(1);
  });

  test("an outside change (Reset) still rebuilds the form from the URL", async ({ page }) => {
    await gotoDiscover(page, "en");
    await page.goto("/en/discover?projectType=urban_regeneration");
    await page.waitForSelector(".opportunity-tile, .empty-state");
    await page.locator(".dock-reset").click();
    await expect(page).toHaveURL(/\/en\/discover$/);
    await page.locator(".dock-pill-summary").first().click();
    await expect(page.locator(".dock-pill[open] .dock-option input:checked")).toHaveCount(0);
  });

  test("a new result brings the top of the list back into view instead of leaving the visitor below it", async ({ page }) => {
    await gotoDiscover(page, "en");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    await page.locator("select[name=sort]").selectOption("latest");
    await expect(page).toHaveURL(/sort=latest/);
    await page.waitForFunction(() => document.querySelector(".discover-dock.is-pending") === null);
    const top = await page.evaluate(() => document.querySelector(".waterfall-feed")!.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(250);
  });
});

for (const locale of LOCALES) {
  test(`support page (${locale}) is one short column of text and links`, async ({ page }) => {
    await page.goto(`/${locale}/support`);
    await page.waitForSelector(".support-links");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expect(page.locator(".support-link")).not.toHaveCount(0);
    const column = (await page.locator(".support-page").boundingBox())!;
    expect(column.width).toBeLessThanOrEqual(36 * 16 + 1);
    await page.screenshot({ path: `artifacts/visual/support-${locale}-${test.info().project.name}.png` });
  });
}
