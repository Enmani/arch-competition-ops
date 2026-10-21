import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: currentDirectory,
});

// next/typescript adds the typescript-eslint recommended rules (no-explicit-any, unused vars,
// ban-ts-comment, ...) on top of the Next.js core-web-vitals rules.
const config = [...compat.config({ extends: ["next/core-web-vitals", "next/typescript"] })];

export default config;
