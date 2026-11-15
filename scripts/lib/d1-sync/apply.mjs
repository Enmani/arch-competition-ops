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

/** `SELECT COUNT(*)` on the remote database, or null when it cannot be read (informational only). */
function remoteCompetitionCount(wrangler, env, repoRoot) {
  const result = runWrangler(
    wrangler,
    ["d1", "execute", D1_DATABASE_NAME, "--remote", "--json", "--command", 'SELECT COUNT(*) AS n FROM "competitions"'],
    { env, repoRoot },
  );
  if (!result.ok) {
    return null;
  }
  try {
    const count = JSON.parse(result.stdout)?.[0]?.results?.[0]?.n;
    return Number.isInteger(count) ? count : null;
  } catch {
    return null;
  }
}

/**
 * Run the generated files against remote D1 in order and stop at the first failure (every file is
 * idempotent, so the same directory can simply be re-run). Output is counts only: wrangler's own
 * output is never echoed, a failure prints one short, secret-masked line.
 */
export function applyExport({ wrangler, env, repoRoot, outputDir, files, manifest, log }) {
  const before = remoteCompetitionCount(wrangler, env, repoRoot);
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
          "Fix the cause and re-run this command; every file is idempotent.",
      );
    }
    applied += 1;
    log(`applied ${file.name} (${file.statements} statement(s))`);
  }
  const after = remoteCompetitionCount(wrangler, env, repoRoot);
  log(`D1 sync complete: ${applied} file(s) applied.`);
  for (const [table, { rows }] of Object.entries(manifest.tables)) {
    log(`d1_rows_upserted ${table}=${rows}`);
  }
  log(`d1_remote_competitions before=${before ?? "n/a"} after=${after ?? "n/a"}`);
}
