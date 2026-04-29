import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const createNextConfig = (phase: string): NextConfig => {
  const isDevelopmentServer = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    distDir: isDevelopmentServer ? ".next-dev" : ".next",
    outputFileTracingRoot: path.join(currentDirectory, "../../"),
    transpilePackages: ["@arch-competition/core", "@arch-competition/storage"],
    experimental: {
      externalDir: true,
    },
  };
};

export default createNextConfig;
