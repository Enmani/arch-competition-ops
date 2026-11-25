import path from "node:path";

import { assertCloudflareCredentials, describeFailure, resolveWrangler, runWrangler } from "../wrangler.mjs";
import { D1_DATABASE_NAME } from "./table-specs.mjs";

export class ApplyError extends Error {}

/** Fail before anything is written when `--apply` cannot work. */
export function prepareApply(env, repoRoot) {
  const wrangler = resolveWrangler(env, repoRoot);
  assertCloudflareCredentials(wrangler, env);
  return wrangler;
}

/** One primary-key read. Older schemas and unavailable metadata use the normal fenced sync. */
function alreadyPublished(wrangler, env, repoRoot, manifest) {
  if (manifest.prune) return false;
  const reply = runWrangler(wrangler,
    ["d1", "execute", D1_DATABASE_NAME, "--remote", "--json", "--command", manifest.unchangedCheck],
    { env, repoRoot });
  if (!reply.ok) return false;
  try {
    return JSON.parse(reply.stdout)?.[0]?.results?.[0]?.unchanged === 1;
  } catch {
    return false;
  }
}

/**
 * Run the generated files against remote D1 in order and stop at the first failure (every file is
 * retryable from the syncing marker). Output is counts only: wrangler's own
 * output is never echoed, a failure prints one short, secret-masked line.
 */
export function applyExport({ wrangler, env, repoRoot, outputDir, files, manifest, log }) {
  if (alreadyPublished(wrangler, env, repoRoot, manifest)) {
    // Anonymous-usage cleanup and records that reached retention age are time dependent.
    files = files.filter(file => file.name === "0090-retention.sql");
    log("Published snapshot unchanged. No opportunity upserts or publication writes.");
  }
  let applied = 0;
  for (const file of files) {
    const result = runWrangler(
      wrangler,
      ["d1", "execute", D1_DATABASE_NAME, "--remote", "--file", path.join(outputDir, file.name)],
      { env, repoRoot },
    );
    if (!result.ok) {
      throw new ApplyError(
        `${file.name} failed (${applied} of ${files.length} file(s) applied): ${describeFailure(result, env)}. ` +
          "Fix the cause and re-run this command from the start.",
      );
    }
    applied += 1;
    log(`applied ${file.name} (${file.statements} statement(s))`);
  }
  log(`D1 sync complete: ${applied} file(s) applied.`);
  for (const [table, { rows }] of Object.entries(manifest.tables)) {
    log(`d1_snapshot_rows ${table}=${rows}`);
  }
}
