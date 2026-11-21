import path from "node:path";

import { assertCloudflareCredentials, describeFailure, resolveWrangler, runWrangler } from "../wrangler.mjs";
import { PRUNE_FILE_NAME, RETENTION_FILE_NAME, SYNC_TABLES } from "./table-specs.mjs";

export class ApplyError extends Error {}

/**
 * The set of tables whose DATA files are all within the first `appliedCount` files.
 * Retention (0090) and prune (0099) are named after a table in the file list but are not
 * that table's data, so they never count toward (or against) its completeness. A table
 * with no data files at all (zero exported rows) is trivially complete. The exporter uses
 * this to advance incremental-sync watermarks only for tables D1 fully received.
 */
export function tablesFullyApplied(files, appliedCount) {
  const totals = new Map();
  const applied = new Map();
  files.forEach((file, index) => {
    if (file.name === RETENTION_FILE_NAME || file.name === PRUNE_FILE_NAME) {
      return;
    }
    totals.set(file.table, (totals.get(file.table) ?? 0) + 1);
    if (index < appliedCount) {
      applied.set(file.table, (applied.get(file.table) ?? 0) + 1);
    }
  });
  const complete = new Set();
  for (const spec of SYNC_TABLES) {
    if ((applied.get(spec.name) ?? 0) === (totals.get(spec.name) ?? 0)) {
      complete.add(spec.name);
    }
  }
  return complete;
}

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
 *
 * Returns `{ appliedTables }`: the tables whose data files were all applied (see
 * tablesFullyApplied). On failure the thrown ApplyError carries the same set for the files
 * that did complete, so the caller can still advance those tables' sync watermarks.
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
      const error = new ApplyError(
        `${file.name} failed (${applied} of ${files.length} file(s) applied): ${describeFailure(result, env)}. ` +
          "Fix the cause and re-run this command; every file is idempotent.",
      );
      error.appliedTables = tablesFullyApplied(files, applied);
      throw error;
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
  return { appliedTables: tablesFullyApplied(files, applied) };
}
