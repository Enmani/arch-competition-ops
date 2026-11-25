// Runs wrangler as a child process for the cloud scripts (cloud-state.mjs, export-d1-data.mjs --apply).
//
// By default it starts the wrangler of the apps/web workspace with the current Node binary:
// no shell, no npm layer, the same behaviour on Windows and Linux, and no console window
// (`windowsHide`). Credentials are read by wrangler itself from CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID.
//
// ARCH_WRANGLER_CMD replaces the whole command so tests can inject a fake. It is either a JSON
// array of strings (`["node", "fake-wrangler.mjs"]`) or one executable path. Never used in production.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

export const WRANGLER_CMD_ENV_VAR = "ARCH_WRANGLER_CMD";
const SECRET_ENV_VARS = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GH_TOKEN"];
const MAX_FAILURE_TEXT = 400;

export function resolveWrangler(env, repoRoot) {
  const override = env[WRANGLER_CMD_ENV_VAR]?.trim();
  if (override) {
    const parts = override.startsWith("[") ? JSON.parse(override) : [override];
    if (!Array.isArray(parts) || parts.length === 0 || parts.some((part) => typeof part !== "string" || !part)) {
      throw new Error(`${WRANGLER_CMD_ENV_VAR} must be a JSON array of non-empty strings or one executable path`);
    }
    return { command: parts[0], args: parts.slice(1), overridden: true };
  }
  const bin = createRequire(path.join(repoRoot, "apps", "web", "package.json")).resolve("wrangler/bin/wrangler.js");
  return { command: process.execPath, args: [bin], overridden: false };
}

/** The real wrangler needs both variables; a test fake does not. Names only, never values. */
export function assertCloudflareCredentials(wrangler, env) {
  if (wrangler.overridden) {
    return;
  }
  const missing = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
  }
}

/** Runs wrangler inside apps/web (where wrangler.jsonc lives). Output is returned, never printed. */
export function runWrangler(wrangler, wranglerArgs, { env, repoRoot, timeoutMs = 10 * 60 * 1000 }) {
  const result = spawnSync(wrangler.command, [...wrangler.args, ...wranglerArgs], {
    cwd: path.join(repoRoot, "apps", "web"),
    env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

/** One short line for a failed call: secrets masked, length capped (logs of a public repo are world-readable). */
export function describeFailure(result, env) {
  let text = result.error
    ? `could not run wrangler: ${result.error.message}`
    : `exit ${result.status}: ${(result.stderr || result.stdout).trim()}`;
  for (const name of SECRET_ENV_VARS) {
    const secret = env[name]?.trim();
    if (secret && secret.length >= 6) {
      text = text.split(secret).join("***");
    }
  }
  text = text.replace(/\s+/g, " ");
  return text.length > MAX_FAILURE_TEXT ? `${text.slice(0, MAX_FAILURE_TEXT)}...` : text;
}
