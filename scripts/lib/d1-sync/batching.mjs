import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PUBLICATION_TABLE, SYNC_PUBLISH_FILE, SYNC_START_FILE } from "./publication.mjs";
import { D1_DATABASE_NAME, MAX_DATA_FILES, PRUNE_FILE_NAME, RETENTION_FILE_NAME } from "./table-specs.mjs";

function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Split one table's statements into batches that respect the per-file statement/byte budgets.
 * Throws when a single statement exceeds D1's per-statement size limit.
 */
export function splitIntoBatches(table, statements, limits) {
  const batches = [];
  let current = [];
  let currentBytes = 0;

  for (const statement of statements) {
    const size = byteLength(statement) + 1; // trailing newline
    if (size > limits.maxStatementBytes) {
      throw new Error(
        `${table}: a single statement is ${size} bytes, above the ${limits.maxStatementBytes} byte limit ` +
          "(D1 rejects statements over 100 KB)",
      );
    }
    if (
      current.length > 0 &&
      (current.length >= limits.maxStatementsPerFile || currentBytes + size > limits.maxFileBytes)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(statement);
    currentBytes += size;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

function toFile(name, table, statements) {
  const content = `${statements.join("\n")}\n`;
  return {
    name,
    table,
    statements: statements.length,
    bytes: byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
  };
}

/**
 * Turn per-table statements (in sync order) plus optional retention and prune statements into the
 * ordered file list, bracketed by the syncing marker and final publication when present.
 */
export function planFiles({ tableStatements, retentionStatements = null, pruneStatements, limits, publication }) {
  const files = [];
  const guarded = (statements) => publication ? [publication.guard, ...statements] : statements;
  const dataLimits = publication ? {
    ...limits,
    maxFileBytes: limits.maxFileBytes - byteLength(publication.guard) - 1,
    maxStatementsPerFile: limits.maxStatementsPerFile - 1,
  } : limits;
  if (dataLimits.maxStatementsPerFile < 1) throw new Error("D1 export needs space for the publication guard");
  for (const { table, statements } of tableStatements) {
    for (const batch of splitIntoBatches(table, statements, dataLimits)) {
      const sequence = String(files.length + 1).padStart(4, "0");
      files.push(toFile(`${sequence}-${table}.sql`, table, guarded(batch)));
    }
  }
  if (files.length > MAX_DATA_FILES) {
    throw new Error(
      `Export needs ${files.length} data files but only ${MAX_DATA_FILES} fit before ${RETENTION_FILE_NAME}; ` +
        "raise the per-file limits in table-specs.mjs",
    );
  }

  if (retentionStatements) {
    files.push(toFile(RETENTION_FILE_NAME, "competitions", guarded(retentionStatements)));
  }

  if (pruneStatements) {
    const pruneFile = toFile(PRUNE_FILE_NAME, "competitions",
      publication ? [publication.pruneGuard, ...pruneStatements] : pruneStatements);
    if (
      pruneFile.statements > limits.maxStatementsPerFile ||
      pruneFile.bytes > limits.maxFileBytes
    ) {
      throw new Error(
        `${PRUNE_FILE_NAME} would hold ${pruneFile.statements} statements / ${pruneFile.bytes} bytes, ` +
          "above the per-file limits; refusing to split the prune step across files",
      );
    }
    files.push(pruneFile);
  }
  if (publication) {
    files.unshift(toFile(SYNC_START_FILE, PUBLICATION_TABLE, publication.start));
    files.push(toFile(SYNC_PUBLISH_FILE, PUBLICATION_TABLE, guarded(publication.finish)));
  }
  return files;
}

export function utcTimestamp(date) {
  return date.toISOString().replace(/\.\d+Z$/, "Z").replaceAll("-", "").replaceAll(":", "");
}

/** Relative path (forward slashes) from apps/web, where `npm --workspace apps/web exec` runs. */
export function wranglerFilePath(repoRoot, filePath) {
  return path.relative(path.join(repoRoot, "apps", "web"), filePath).split(path.sep).join("/");
}

export function buildWranglerCommands({ repoRoot, outputDir, files }) {
  return files.map(
    (file) =>
      `npm --workspace apps/web exec -- wrangler d1 execute ${D1_DATABASE_NAME} --remote ` +
      `--file ${wranglerFilePath(repoRoot, path.join(outputDir, file.name))}`,
  );
}

/**
 * Write all SQL files and manifest.json. Called only after every statement has been generated
 * and validated, so a failed export leaves nothing on disk. The timestamped directory must be
 * new (non-recursive mkdir) so an earlier export is never overwritten.
 */
export function writeExport({ outputDir, files, manifest }) {
  mkdirSync(path.dirname(outputDir), { recursive: true });
  mkdirSync(outputDir);
  for (const file of files) {
    writeFileSync(path.join(outputDir, file.name), file.content, "utf8");
  }
  writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
