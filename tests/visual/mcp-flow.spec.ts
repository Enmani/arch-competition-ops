// The MCP entry end to end in a real browser: connect page -> sign up -> create a key -> the key
// appears in the commands and works against /mcp -> account page usage -> upgrade sends a
// checkout request. Stripe is never called: the checkout response and the Stripe page are
// fulfilled locally. Each run signs up new accounts, and sign-up is limited to 5 per IP per hour,
// so run one project pair at a time (`--project desktop --project mobile`) on a scratch database.
// Screenshots (light and dark) go to artifacts/visual/mcp for review.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const SHOTS = "artifacts/visual/mcp";
const PASSWORD = "correct-horse-battery";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

// Any console error (hydration mismatch, failed render) fails the test that caused it. Responses
// a test provokes on purpose (the 503 and 409 below) are logged by the browser as failed loads.
const consoleErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
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

const shoot = async (page: Page, testInfo: TestInfo, name: string) => {
  // Hydrated first; `caret: "initial"` keeps Playwright from styling inputs mid-hydration.
  await page.waitForLoadState("networkidle");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ animations: "disabled", caret: "initial", fullPage: true, path: `${SHOTS}/${testInfo.project.name}-${name}-${colorScheme}.png` });
  }
  await page.emulateMedia({ colorScheme: null });
};

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const uniqueEmail = (testInfo: TestInfo, tag: string) =>
  `mcp-${tag}-${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}@example.test`;

const usage = (plan: "free" | "paid", monthUsed: number, minuteUsed = 0) => ({
  minute: { limit: plan === "paid" ? 60 : 20, resetsAt: "2026-11-22T12:01:00.000Z", used: minuteUsed },
  month: { limit: plan === "paid" ? 5000 : 300, resetsAt: "2026-12-01T00:00:00.000Z", used: monthUsed },
  plan,
});

const callMcp = (page: Page, key: string | null) =>
  page.request.post("/mcp", {
    data: { id: 1, jsonrpc: "2.0", method: "tools/call", params: { arguments: { days: 30, limit: 1 }, name: "list_closing_soon" } },
    headers: {
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
  });

for (const locale of ["en", "zh"] as const) {
  test(`connect page works without an account (${locale})`, async ({ page }, testInfo) => {
    await page.goto(`/${locale}/connect`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".mcp-endpoint-url")).toHaveText(/\/mcp$/);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Arrow keys move between client tabs (roving tabindex).
    await page.getByRole("tab").first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Claude Code" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".mcp-code")).not.toContainText("Authorization");
    await shoot(page, testInfo, `connect-anonymous-${locale}`);

    // The address on the page answers anonymously.
    const response = await callMcp(page, null);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-ratelimit-plan"]).toBe("anonymous");

    await page.goto(`/${locale}/pricing`);
    await expect(page.locator(".pricing-tier")).toHaveCount(3);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, testInfo, `pricing-anonymous-${locale}`);
  });
}

test("connect -> sign up -> key in the command -> key works -> upgrade sends checkout (en)", async ({ page }, testInfo) => {
  await page.goto("/en/connect");
  await page.waitForLoadState("networkidle");

  // 1. Get a key: the sign-up sheet opens over the connect page.
  await page.locator(".mcp-key-strip").getByRole("link", { name: "Get a key" }).click();
  await page.locator("#auth-dialog-register-email").fill(uniqueEmail(testInfo, "connect"));
  await page.locator("#auth-dialog-register-password").fill(PASSWORD);
  await page.locator("#auth-dialog-register-confirmation").fill(PASSWORD);
  await page.locator(".auth-dialog form button[type=submit]").click();

  // 2. Back on the same page, signed in: create the key in place.
  const create = page.locator(".mcp-key-strip").getByRole("button", { name: "Create key" });
  await create.click();
  const keyValue = page.locator(".mcp-dialog[open] .mcp-key-value");
  await expect(keyValue).toHaveText(/^arch_mcp_/);
  const key = (await keyValue.textContent()) ?? "";
  await shoot(page, testInfo, "new-key-dialog-en");
  await page.locator(".mcp-dialog[open]").getByRole("button", { name: /^Copy/ }).click();
  await expect(page.locator(".mcp-dialog[open] [aria-live]")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
  await page.getByRole("button", { name: "I've saved it" }).click();
  await expect(page.locator(".mcp-dialog[open]")).toHaveCount(0);
  await expect(page.locator(".mcp-key-strip").getByRole("button", { name: "Show" })).toBeFocused();

  // 3. The commands carry the key, hidden until shown.
  await page.getByRole("tab", { name: "Claude Code" }).click();
  await expect(page.locator(".mcp-code")).toContainText("Bearer arch_mcp_");
  await expect(page.locator(".mcp-code")).not.toContainText(key);
  await page.locator(".mcp-key-strip").getByRole("button", { name: "Show" }).click();
  await expect(page.locator(".mcp-code")).toContainText(key);
  await page.locator(".mcp-key-strip").getByRole("button", { name: "Hide" }).click();
  await shoot(page, testInfo, "connect-with-key-en");

  // 4. The key works against the endpoint on the free plan.
  const response = await callMcp(page, key);
  expect(response.status()).toBe(200);
  expect(response.headers()["x-ratelimit-plan"]).toBe("free");

  // 5. Account page: the key is listed and the call is counted.
  await page.goto("/en/dashboard");
  await expect(page.locator(".mcp-key-row")).toHaveCount(1);
  await expect(page.locator(".mcp-meter-count").first()).toHaveText(/^1 \/ 300$/);
  await shoot(page, testInfo, "dashboard-free-en");

  // 6. Upgrade: yearly, the click sends the checkout request and follows the returned URL.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let checkoutBody: unknown = null;
  await page.route("**/api/mcp/billing/checkout", async (route) => {
    checkoutBody = route.request().postDataJSON();
    await held;
    await route.fulfill({ json: { url: "https://checkout.stripe.com/c/pay/cs_test_local" } });
  });
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ body: "<title>Stripe test</title><p>Checkout stand-in</p>", contentType: "text/html" }),
  );
  await page.getByRole("radio", { name: "Yearly" }).check();
  await page.getByRole("button", { name: "Upgrade to Pro" }).click();
  await expect(page.getByRole("button", { name: "Opening checkout" })).toBeDisabled();
  release();
  await page.waitForURL("https://checkout.stripe.com/**");
  expect(checkoutBody).toEqual({ interval: "year", locale: "en" });

  // 7. Back with ?billing=success: usage is re-read until the plan shows Pro; the URL is cleaned.
  let reads = 0;
  await page.route("**/api/mcp/usage", (route) => {
    reads += 1;
    return route.fulfill({ json: reads < 2 ? usage("free", 1) : usage("paid", 1) });
  });
  await page.goto("/en/dashboard?billing=success");
  await expect(page.getByText("Payment complete. You're on Pro.")).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await expect(page.getByRole("button", { name: "Manage subscription" })).toBeVisible();
  await page.unroute("**/api/mcp/usage");

  await page.goto("/en/dashboard?billing=cancel");
  await expect(page.getByText("Checkout cancelled. Your plan hasn't changed.")).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("account page: first key, limits, errors and revoking (zh)", async ({ page }, testInfo) => {
  // Signing up on the plain page with no return path lands on the account page.
  await page.goto("/zh/register");
  await page.locator("#register-email").fill(uniqueEmail(testInfo, "dashboard"));
  await page.locator("#register-password").fill(PASSWORD);
  await page.locator("#register-password-confirmation").fill(PASSWORD);
  await page.locator(".auth-form button[type=submit]").click();
  await page.waitForURL("**/zh/dashboard");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".mcp-empty")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await shoot(page, testInfo, "dashboard-empty-zh");

  // Billing is not configured locally: the real 503 shows its next step and keeps the plan.
  await page.getByRole("button", { name: "升级到 Pro" }).click();
  await expect(page.locator(".mcp-plan .mcp-notice.is-error")).toContainText("当前套餐不受影响");
  await shoot(page, testInfo, "dashboard-billing-error-zh");

  // First key from the account page, with the default name.
  await page.locator("#mcp-key-name").fill("");
  await page.locator("#mcp-key-name").fill("Default");
  await page.getByRole("button", { name: "创建 Key" }).click();
  await expect(page.locator(".mcp-dialog[open] .mcp-key-value")).toHaveText(/^arch_mcp_/);
  await page.getByRole("button", { name: "我已保存" }).click();
  await expect(page.locator(".mcp-key-row")).toHaveCount(1);
  await expect(page.locator("#mcp-key-name")).toHaveValue("Default 2");

  // Near and at the limit (usage response stubbed): state text and the next step.
  await page.route("**/api/mcp/usage", (route) => route.fulfill({ json: usage("free", 250) }));
  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.locator(".mcp-meter.is-near")).toHaveCount(1);
  await shoot(page, testInfo, "dashboard-near-limit-zh");
  await page.unroute("**/api/mcp/usage");
  await page.route("**/api/mcp/usage", (route) => route.fulfill({ json: usage("free", 300, 20) }));
  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.locator(".mcp-meter.is-full")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "升级到 Pro 可提高额度。" })).toBeVisible();
  await page.unroute("**/api/mcp/usage");

  // A conflicting checkout points to the portal.
  await page.route("**/api/mcp/billing/checkout", (route) =>
    route.fulfill({ json: { error: { code: "conflict", message: "x" } }, status: 409 }),
  );
  await page.getByRole("button", { name: "升级到 Pro" }).click();
  await expect(page.locator(".mcp-plan .mcp-notice.is-error").getByRole("button", { name: "管理订阅" })).toBeVisible();
  await page.unroute("**/api/mcp/billing/checkout");

  // Revoke with confirmation; cancelling returns focus to the button that opened it.
  const revoke = page.locator(".mcp-key-row").getByRole("button", { name: /^吊销/ });
  await revoke.click();
  await expect(page.locator(".mcp-dialog[open]")).toContainText("吊销 Default？");
  await shoot(page, testInfo, "dashboard-revoke-confirm-zh");
  await page.locator(".mcp-dialog[open]").getByRole("button", { name: "取消" }).click();
  await expect(revoke).toBeFocused();
  await revoke.click();
  await page.locator(".mcp-dialog[open]").getByRole("button", { name: "吊销" }).click();
  await expect(page.locator(".mcp-key-row.is-revoked")).toHaveCount(1);

  await page.goto("/zh/pricing");
  await expect(page.locator(".pricing-current")).toHaveText("当前套餐");
  await shoot(page, testInfo, "pricing-signed-in-zh");
});
