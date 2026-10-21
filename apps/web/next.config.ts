import path from "node:path";
import { fileURLToPath } from "node:url";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

// Baseline hardening for every response served by the app. A Content-Security-Policy is
// deliberately not set here: it needs a nonce strategy for the inline scripts Next.js emits and is
// tracked separately. HSTS is skipped for the dev server (browsers ignore it over http anyway).
const buildSecurityHeaders = (isDevelopmentServer: boolean) => [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDevelopmentServer
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
];

const createNextConfig = (phase: string): NextConfig => {
  const isDevelopmentServer = phase === PHASE_DEVELOPMENT_SERVER;
  const tsconfigPath = isDevelopmentServer ? "tsconfig.json" : "tsconfig.build.json";

  if (isDevelopmentServer) {
    void initOpenNextCloudflareForDev({
      configPath: path.join(currentDirectory, "wrangler.jsonc"),
    });
  }

  return {
    distDir: isDevelopmentServer ? ".next-dev" : ".next",
    outputFileTracingRoot: path.join(currentDirectory, "../../"),
    transpilePackages: [
      "@arch-competition/core",
      "@arch-competition/previews",
      "@arch-competition/storage",
    ],
    typescript: {
      tsconfigPath,
    },
    async headers() {
      return [{ source: "/:path*", headers: buildSecurityHeaders(isDevelopmentServer) }];
    },
    experimental: {
      externalDir: true,
    },
  };
};

export default createNextConfig;
