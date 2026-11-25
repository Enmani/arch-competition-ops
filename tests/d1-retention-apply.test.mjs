// export-d1-data.mjs: the remote retention file (0090-retention.sql) and the --apply mode.
// SQL runs against temporary SQLite databases built from the real migrations (foreign keys ON, like D1);
// --apply runs through tests/helpers/fake-wrangler.mjs. Nothing here reaches Cloudflare.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { main } from "../scripts/export-d1-data.mjs";
import { buildRetentionStatements } from "../scripts/lib/d1-sync/retention.mjs";
import {
  REPO_ROOT,
  USER_TABLES,
  applyMigrations,
  createLocalDatabase,
  createWorkspace,
  dumpTable,
  insertCompetition,
  insertQueueItem,
  runInto,
  seedRemoteUserData,
  seedWorkerData,
} from "./helpers/d1-sync-fixtures.mjs";

const NOW = new Date("2026-11-15T02:00:00Z"); // cut-off: 2026-11-08
const FAKE_WRANGLER = path.join(REPO_ROOT, "tests", "helpers", "fake-wrangler.mjs");

function remoteDatabase({ foreignKeys = true } = {}) {
  const database = applyMigrations(new Database(":memory:"));
  database.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  return database;
}

function addAssessment(database, id, { decision = "exclude", sourceUpdatedAt = "2026-01-02T00:00:00Z", updatedAt } = {}) {
  database
    .prepare(
      `INSERT INTO ai_screening_results (competition_id, source_updated_at, model, decision, relevance_score, result_json, updated_at)
       VALUES (?, ?, 'model', ?, 10, '{}', ?)`,
    )
    .run(id, sourceUpdatedAt, decision, updatedAt);
}

function applyRetention(database, now = NOW) {
  for (const statement of buildRetentionStatements(now)) {
    database.exec(statement);
  }
}

function ids(database) {
  return dumpTable(database, "competitions", "id").map((row) => row.id);
}

test("retention SQL embeds the cut-off dates and limits its tables", () => {
  const statements = buildRetentionStatements(NOW);
  const sql = statements.join("\n");
  assert.equal(statements.length, 4);
  assert.match(sql, /date\('2026-11-15', '-7 days'\)/);
  assert.match(sql, /unixepoch\('2026-11-01'\)/);
  assert.doesNotMatch(sql, /\bnow\b|CURRENT_|datetime\(/i, "deterministic: no clock inside the SQL");
  assert.doesNotMatch(sql, /\b(BEGIN|COMMIT|SAVEPOINT|ROLLBACK)\b/i);
  assert.deepEqual(
    [...new Set([...sql.matchAll(/(?:DELETE FROM|FROM) "(\w+)"/g)].map((match) => match[1]))].sort(),
    ["ai_screening_results", "competitions", "mcp_usage", "workspace_watchlist_entries"],
  );
  assert.doesNotMatch(sql, /auth_|ops_review|workspace_saved/);
});

test("retention deletes prior-month anonymous usage and preserves current and account counters", () => {
  const remote = remoteDatabase();
  try {
    seedRemoteUserData(remote);
    const user = remote.prepare("SELECT id FROM auth_users").pluck().get();
    const insert = remote.prepare("INSERT INTO mcp_usage VALUES (?, ?, ?, 3, 0, 0)");
    const october = Date.parse("2026-10-01T00:00:00Z") / 1000;
    const november = Date.parse("2026-11-01T00:00:00Z") / 1000;
    insert.run("anon:old", null, october);
    insert.run("anon:current", null, november);
    insert.run("global:anonymous", null, october);
    insert.run(`user:${user}`, user, october);

    applyRetention(remote);
    applyRetention(remote);
    assert.deepEqual(remote.prepare("SELECT subject FROM mcp_usage ORDER BY subject").pluck().all(),
      ["anon:current", "global:anonymous", `user:${user}`]);
  } finally {
    remote.close();
  }
});

test("deadline rule: more than 7 days past is deleted, the boundary day and open deadlines stay", () => {
  const remote = remoteDatabase();
  insertCompetition(remote, "past", { deadline_at: "2026-11-07" });
  insertCompetition(remote, "boundary", { deadline_at: "2026-11-08" });
  insertCompetition(remote, "recent", { deadline_at: "2026-11-12" });
  insertCompetition(remote, "future", { deadline_at: "2027-01-01" });
  insertCompetition(remote, "no-deadline");
  insertCompetition(remote, "shortlisted-past", { deadline_at: "2026-10-01", status: "shortlisted" });

  applyRetention(remote);

  // Same as the worker: a deadline past the window removes the record whatever its status.
  assert.deepEqual(ids(remote), ["boundary", "future", "no-deadline", "recent"]);
  remote.close();
});

test("exclusion rule: only a current, old exclude on a record that is not shortlisted, verified or watched", () => {
  const remote = remoteDatabase();
  const old = "2026-11-01T10:00:00Z";
  const cases = {
    "excl-old": { assessment: { updatedAt: old }, gone: true },
    "excl-recent": { assessment: { updatedAt: "2026-11-10T10:00:00Z" }, gone: false },
    "excl-boundary-day": { assessment: { updatedAt: "2026-11-08T00:00:00Z" }, gone: false },
    "excl-stale-revision": { assessment: { updatedAt: old, sourceUpdatedAt: "2026-01-01T00:00:00Z" }, gone: false },
    "excl-shortlisted": { competition: { status: "shortlisted" }, assessment: { updatedAt: old }, gone: false },
    "excl-verified": { competition: { status: "verified" }, assessment: { updatedAt: old }, gone: false },
    "excl-closed": { competition: { status: "closed" }, assessment: { updatedAt: old }, gone: true },
    "include-old": { assessment: { updatedAt: old, decision: "include" }, gone: false },
    "no-assessment": { gone: false },
  };
  for (const [id, { competition, assessment }] of Object.entries(cases)) {
    insertCompetition(remote, id, competition);
    if (assessment) {
      addAssessment(remote, id, assessment);
    }
  }
  insertCompetition(remote, "excl-watched");
  addAssessment(remote, "excl-watched", { updatedAt: old });
  remote
    .prepare(
      `INSERT INTO workspace_watchlist_entries (workspace_key, opportunity_id, created_at, updated_at)
       VALUES ('ws1', 'excl-watched', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
    )
    .run();

  applyRetention(remote);

  const expectedGone = Object.entries(cases)
    .filter(([, { gone }]) => gone)
    .map(([id]) => id);
  const remaining = ids(remote);
  for (const id of Object.keys(cases)) {
    assert.equal(remaining.includes(id), !expectedGone.includes(id), id);
  }
  assert.ok(remaining.includes("excl-watched"));
  // The cascade removed the results of the deleted records only.
  assert.deepEqual(
    dumpTable(remote, "ai_screening_results", "competition_id").map((row) => row.competition_id),
    remaining.filter((id) => id.startsWith("excl-") || id === "include-old").sort(),
  );
  remote.close();
});

test("watchlisted records survive both rules, and user tables are untouched", () => {
  const remote = remoteDatabase();
  seedRemoteUserData(remote); // comp-watched is on a watchlist
  remote.prepare("UPDATE competitions SET deadline_at = '2020-01-01' WHERE id = 'comp-watched'").run();
  addAssessment(remote, "comp-watched", { updatedAt: "2026-01-01T00:00:00Z" });
  remote.prepare("UPDATE ai_screening_results SET source_updated_at = '2026-01-02T00:00:00Z'").run();
  const before = USER_TABLES.map(([table, order]) => dumpTable(remote, table, order));

  applyRetention(remote);

  assert.deepEqual(ids(remote), ["comp-watched"]);
  assert.equal(dumpTable(remote, "ai_screening_results", "competition_id").length, 1);
  assert.deepEqual(
    USER_TABLES.map(([table, order]) => dumpTable(remote, table, order)),
    before,
  );
  remote.close();
});

test("deleting a competition keeps the audit trail: queue items and decisions stay, run rows lose the link", () => {
  const remote = remoteDatabase();
  insertCompetition(remote, "gone", { deadline_at: "2026-01-01" });
  insertQueueItem(remote, "q-1", { competition_id: "gone" });
  remote
    .prepare(
      `INSERT INTO ops_review_decisions (queue_id, decision, actor_label, created_at)
       VALUES ('q-1', 'accepted', 'alice', '2026-02-02T00:00:00Z')`,
    )
    .run();
  remote
    .prepare(
      `INSERT INTO ai_screening_runs (id, competition_id, source_url, model, input_json, status, cost_usd, started_at)
       VALUES ('run-1', 'gone', 'https://example.test/n', 'model', '{}', 'done', 0.01, '2026-01-01T00:00:00Z')`,
    )
    .run();

  applyRetention(remote);

  assert.deepEqual(ids(remote), []);
  assert.equal(dumpTable(remote, "ops_review_queue_items", "queue_id")[0].competition_id, "gone");
  assert.equal(dumpTable(remote, "ops_review_decisions", "id").length, 1);
  assert.equal(dumpTable(remote, "ai_screening_runs", "id")[0].competition_id, null);
  remote.close();
});

test("retention is idempotent and sweeps orphaned results when foreign keys are not enforced", () => {
  const remote = remoteDatabase({ foreignKeys: false });
  insertCompetition(remote, "gone", { deadline_at: "2026-01-01" });
  insertCompetition(remote, "keep");
  addAssessment(remote, "gone", { decision: "include", updatedAt: "2026-01-01T00:00:00Z" });
  addAssessment(remote, "keep", { decision: "include", updatedAt: "2026-01-01T00:00:00Z" });

  applyRetention(remote);
  applyRetention(remote);

  assert.deepEqual(ids(remote), ["keep"]);
  assert.deepEqual(
    dumpTable(remote, "ai_screening_results", "competition_id").map((row) => row.competition_id),
    ["keep"],
  );
  remote.close();
});

test("retention is off by default and becomes the 0090 file, before 0099-prune, when asked for", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, seedWorkerData);

  const plain = runInto(workspace);
  assert.ok(plain.files.every((file) => !file.name.includes("retention")));
  assert.equal(plain.manifest.retention, false);

  const workspace2 = createWorkspace(t);
  createLocalDatabase(workspace2.dbPath, seedWorkerData);
  const withBoth = runInto(workspace2, { retention: true, prune: true, now: NOW });
  assert.deepEqual(withBoth.files.slice(-3).map((file) => file.name), ["0090-retention.sql", "0099-prune.sql", "0100-publish.sql"]);
  assert.equal(withBoth.manifest.retention, true);
  assert.equal(withBoth.wranglerCommands.length, withBoth.files.length);
});

// -- --apply ---------------------------------------------------------------------------------

function applySetup(t, { remoteSeed } = {}) {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, seedWorkerData);
  const remotePath = path.join(workspace.dir, "remote.sqlite");
  const remote = applyMigrations(new Database(remotePath));
  seedRemoteUserData(remote);
  insertCompetition(remote, "stale-remote", { deadline_at: "2020-01-01" });
  remoteSeed?.(remote);
  remote.close();
  const store = path.join(workspace.dir, "fake-wrangler");
  const env = {
    PATH: process.env.PATH,
    ARCH_COMPETITION_OPS_DB: workspace.dbPath,
    ARCH_WRANGLER_CMD: JSON.stringify([process.execPath, FAKE_WRANGLER]),
    FAKE_WRANGLER_DIR: store,
    FAKE_D1_DB: remotePath,
  };
  return { ...workspace, env, store, remotePath };
}

// Each export lands in <out-dir>/<UTC second>; a distinct out-dir per call keeps back-to-back runs apart.
function runMain(ctx, argv, env = ctx.env, outName = "out") {
  const out = [];
  const err = [];
  const original = console.error;
  console.error = (message) => err.push(String(message));
  try {
    const code = main([...argv, "--out-dir", path.join(ctx.dir, outName)], env, (line) => out.push(line));
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.error = original;
  }
}

function d1Calls(ctx) {
  const log = path.join(ctx.store, "calls.log");
  if (!existsSync(log)) {
    return [];
  }
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((args) => args[0] === "d1" && args.includes("--file"))
    .map((args) => path.basename(args[args.indexOf("--file") + 1]));
}

function openRemote(ctx) {
  return new Database(ctx.remotePath, { readonly: true });
}

test("--apply runs every file in order, ends by publishing after retention, and reports counts", (t) => {
  const ctx = applySetup(t);
  const result = runMain(ctx, ["--apply"]);
  assert.equal(result.code, 0, result.err);

  const calls = d1Calls(ctx);
  assert.deepEqual(calls, [...calls].sort(), "files run in name order");
  assert.deepEqual(calls.slice(-2), ["0090-retention.sql", "0100-publish.sql"]);
  assert.equal(calls[0], "0000-syncing.sql");
  assert.match(calls[1], /^0001-competitions\.sql$/);
  assert.match(result.out, /D1 sync complete: \d+ file\(s\) applied\./);
  assert.match(result.out, /d1_row_metrics rows_read=\d+ rows_written=\d+ changes=\d+ duration_ms=\d+/);
  assert.match(result.out, /d1_snapshot_rows competitions=2/);

  const remote = openRemote(ctx);
  assert.deepEqual(ids(remote), ["comp-1", "comp-2", "comp-watched"]);
  assert.deepEqual(
    USER_TABLES.map(([table]) => remote.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n),
    [1, 1, 1, 1, 1],
    "user tables intact",
  );
  remote.close();
  assert.doesNotMatch(result.out + result.err, /It's|DROP TABLE|INSERT INTO/, "no SQL values in the output");
});

test("a repeated apply reads the singleton and only sends time-dependent retention", (t) => {
  const ctx = applySetup(t);
  assert.equal(runMain(ctx, ["--apply"]).code, 0);
  const before = d1Calls(ctx).length;
  const again = runMain(ctx, ["--apply"], ctx.env, "out-again");
  assert.equal(again.code, 0, again.err);
  assert.deepEqual(d1Calls(ctx).slice(before), ["0090-retention.sql"]);
  const calls = readFileSync(path.join(ctx.store, "calls.log"), "utf8");
  assert.doesNotMatch(calls, /COUNT\(\*\) FROM competitions/i);
});

test("--apply stops at the first failing file and says which one", (t) => {
  const ctx = applySetup(t);
  ctx.env.FAKE_FAIL_FILE = "source_runs";
  const result = runMain(ctx, ["--apply"]);

  assert.equal(result.code, 1);
  assert.match(result.err, /\d+-source_runs\.sql failed \(2 of \d+ file\(s\) applied\)/);
  assert.match(result.err, /re-run/);
  const calls = d1Calls(ctx);
  assert.equal(calls.at(-1).includes("source_runs"), true);
  assert.ok(!calls.includes("0090-retention.sql"), "nothing runs after the failure");
  const remote = openRemote(ctx);
  assert.ok(ids(remote).includes("stale-remote"), "retention did not run");
  assert.deepEqual(remote.prepare("SELECT syncing, version FROM discover_publication").get(), { syncing: 1, version: null });
  remote.close();

  // The files are idempotent: a re-run after the cause is fixed completes the sync.
  delete ctx.env.FAKE_FAIL_FILE;
  assert.equal(runMain(ctx, ["--apply"], ctx.env, "out-retry").code, 0);
});

test("--apply needs Cloudflare credentials for the real wrangler and writes nothing without them", (t) => {
  const ctx = applySetup(t);
  const env = { PATH: process.env.PATH, ARCH_COMPETITION_OPS_DB: ctx.dbPath };
  const result = runMain(ctx, ["--apply"], env);
  assert.equal(result.code, 1);
  assert.match(result.err, /CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID/);
  assert.equal(existsSync(path.join(ctx.dir, "out")), false);
});

test("without --apply nothing is executed; --retention only writes the file", (t) => {
  const ctx = applySetup(t);
  const plain = runMain(ctx, []);
  assert.equal(plain.code, 0, plain.err);
  assert.equal(existsSync(path.join(ctx.store, "calls.log")), false, "wrangler was not called");
  assert.match(plain.out, /Nothing was executed/);

  const retention = runMain(ctx, ["--retention"], ctx.env, "out-retention");
  assert.equal(retention.code, 0, retention.err);
  assert.equal(existsSync(path.join(ctx.store, "calls.log")), false, "wrangler was not called");
  assert.match(retention.out, /--retention: ENABLED/);
  const root = path.join(ctx.dir, "out-retention");
  assert.ok(existsSync(path.join(root, readdirSync(root)[0], "0090-retention.sql")));
});
