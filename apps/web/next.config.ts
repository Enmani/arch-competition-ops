import path from "node:path";
import { fileURLToPath } from "node:url";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { opportunityImageRevision } from "./src/lib/opportunity-preview-revision";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

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
    transpilePackages: ["@arch-competition/core", "@arch-competition/storage"],
    typescript: {
      tsconfigPath,
    },
    images: {
      localPatterns: [
        {
          pathname: "/api/opportunities/**",
          search: `?rev=${opportunityImageRevision}`,
        },
      ],
    },
    experimental: {
      externalDir: true,
    },
  };
};

export default createNextConfig;
