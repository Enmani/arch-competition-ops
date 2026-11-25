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

/** Parse wrangler `--json` metadata (rows_read / rows_written / changes) without echoing SQL. */
function parseRowMetrics(stdout) {
  if (!stdout || !stdout.trim()) return null;
  try {
    const parsed = JSON.parse(stdout);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    let rowsRead = 0;
    let rowsWritten = 0;
    let changes = 0;
    let found = false;
    for (const entry of entries) {
      const meta = entry?.meta;
      if (!meta || typeof meta !== "object") continue;
      if (typeof meta.rows_read === "number") {
        rowsRead += meta.rows_read;
        found = true;
      }
      if (typeof meta.rows_written === "number") {
        rowsWritten += meta.rows_written;
        found = true;
      }
      if (typeof meta.changes === "number") {
        changes += meta.changes;
        found = true;
      }
    }
    return found ? { rowsRead, rowsWritten, changes } : null;
  } catch {
    return null;
  }
}

/**
 * Run the generated files against remote D1 in order and stop at the first failure (every file is
 * retryable from the syncing marker). Output is counts only: wrangler's own
 * output is never echoed, a failure prints one short, secret-masked line.
 */
export function applyExport({ wrangler, env, repoRoot, outputDir, files, manifest, log }) {
  const startedAt = Date.now();
  if (alreadyPublished(wrangler, env, repoRoot, manifest)) {
    // Anonymous-usage cleanup and records that reached retention age are time dependent.
    files = files.filter(file => file.name === "0090-retention.sql");
    log("Published snapshot unchanged. No opportunity upserts or publication writes.");
  }
  let applied = 0;
  let totalRead = 0;
  let totalWritten = 0;
  let totalChanges = 0;
  let hasMetrics = false;
  for (const file of files) {
    const result = runWrangler(
      wrangler,
      ["d1", "execute", D1_DATABASE_NAME, "--remote", "--json", "--file", path.join(outputDir, file.name)],
      { env, repoRoot },
    );
    if (!result.ok) {
      throw new ApplyError(
        `${file.name} failed (${applied} of ${files.length} file(s) applied): ${describeFailure(result, env)}. ` +
          "Fix the cause and re-run this command from the start.",
      );
    }
    applied += 1;
    const metrics = parseRowMetrics(result.stdout);
    if (metrics) {
      hasMetrics = true;
      totalRead += metrics.rowsRead;
      totalWritten += metrics.rowsWritten;
      totalChanges += metrics.changes;
      log(
        `applied ${file.name} (${file.statements} statement(s), ` +
          `rows_read=${metrics.rowsRead}, rows_written=${metrics.rowsWritten}, changes=${metrics.changes})`,
      );
    } else {
      log(`applied ${file.name} (${file.statements} statement(s))`);
    }
  }
  const durationMs = Date.now() - startedAt;
  log(`D1 sync complete: ${applied} file(s) applied.`);
  if (hasMetrics) {
    log(
      `d1_row_metrics rows_read=${totalRead} rows_written=${totalWritten} ` +
        `changes=${totalChanges} duration_ms=${durationMs}`,
    );
  } else {
    log(`d1_sync_duration_ms=${durationMs}`);
  }
  for (const [table, { rows }] of Object.entries(manifest.tables)) {
    log(`d1_snapshot_rows ${table}=${rows}`);
  }
}
