import { defineConfig } from "@playwright/test";

// Layout checks against the running site (port 3400). They use the machine's own Chrome so no browser
// download is needed. Start the site first (`npm run dev:web:up`); an already running one is reused.
export default defineConfig({
  testDir: "tests/visual",
  outputDir: "artifacts/visual/results",
  reporter: [["list"]],
  fullyParallel: true,
  // The dev server compiles a route on first visit, so the first hit of each is slow.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3400",
    channel: "chrome",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "desktop-dark", use: { viewport: { width: 1440, height: 900 }, colorScheme: "dark" } },
  ],
  webServer: {
    command: "npm run dev:web:up",
    url: "http://localhost:3400/en/discover",
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
