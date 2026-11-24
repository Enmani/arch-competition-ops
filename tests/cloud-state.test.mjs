// scripts/cloud-state.mjs against a fake wrangler that keeps R2 objects in a temp directory.
// No Cloudflare, no network, no real database.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import Database from "better-sqlite3";

import { KEEP_GENERATIONS, main } from "../scripts/cloud-state.mjs";
import { REPO_ROOT, applyMigrations, createWorkspace } from "./helpers/d1-sync-fixtures.mjs";

const FAKE_WRANGLER = path.join(REPO_ROOT, "tests", "helpers", "fake-wrangler.mjs");
const BUCKET = "arch-competition-state";

function setup(t) {
  const workspace = createWorkspace(t);
  const dataDir = path.join(workspace.dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const store = path.join(workspace.dir, "fake-wrangler");
  const env = {
    PATH: process.env.PATH,
    ARCH_COMPETITION_OPS_DB: path.join(dataDir, "competitions.sqlite"),
    ARCH_WRANGLER_CMD: JSON.stringify([process.execPath, FAKE_WRANGLER]),
    FAKE_WRANGLER_DIR: store,
  };
  const r2 = (...parts) => path.join(store, "r2", BUCKET, ...parts);
  return { ...workspace, dataDir, env, store, dbPath: env.ARCH_COMPETITION_OPS_DB, r2 };
}

/** Run the CLI in-process; returns the exit code and what it printed. */
async function run(ctx, argv, { env = {}, now = new Date("2026-11-15T02:00:00Z") } = {}) {
  const out = [];
  const err = [];
  const original = console.error;
  console.error = (message) => err.push(String(message));
  try {
    const code = await main(argv, { ...ctx.env, ...env }, { log: (line) => out.push(line), repoRoot: REPO_ROOT, now });
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.error = original;
  }
}

function seedLocal(dbPath, ledgerRows, { geocode = null } = {}) {
  const database = applyMigrations(new Database(dbPath));
  try {
    const insert = database.prepare(
      `INSERT INTO ai_notice_ledger (source_id, content_hash, criteria_hash, outcome, source_url, recorded_at)
       VALUES ('src', ?, 'crit', 'assessed', 'https://example.test/n', '2026-11-14T00:00:00Z')`,
    );
    for (let index = 0; index < ledgerRows; index += 1) {
      insert.run(`hash-${index}`);
    }
  } finally {
    database.close();
  }
  if (geocode) {
    writeFileSync(path.join(path.dirname(dbPath), "geocoding-cache.json"), JSON.stringify(geocode));
  }
}

function ledgerCount(dbPath) {
  const database = new Database(dbPath, { fileMustExist: true });
  try {
    return database.prepare("SELECT COUNT(*) AS n FROM ai_notice_ledger").get().n;
  } finally {
    database.close();
  }
}

function listObjects(ctx, ...parts) {
  return readdirSync(ctx.r2(...parts), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test("push --init then pull restores the database and the geocode cache", async (t) => {
  const ctx = setup(t);
  seedLocal(ctx.dbPath, 3, { geocode: { "rome, it": [41.9, 12.5] } });

  const pushed = await run(ctx, ["push", "--init"]);
  assert.equal(pushed.code, 0, pushed.err);
  assert.match(pushed.out, /Pushed generation 20261115T020000Z .*ai_notice_ledger=3/);

  const pointer = JSON.parse(readFileSync(ctx.r2("latest.json"), "utf8"));
  assert.equal(pointer.generation, "20261115T020000Z");
  assert.equal(pointer.db.key, "state/20261115T020000Z/competitions.sqlite.gz");
  assert.match(pointer.db.sha256, /^[0-9a-f]{64}$/);
  assert.equal(pointer.counts.ai_notice_ledger, 3);
  assert.ok(existsSync(ctx.r2("state", "20261115T020000Z", "geocoding-cache.json.gz")));

  // A fresh machine: no local state at all.
  const fresh = setup(t);
  fresh.env.FAKE_WRANGLER_DIR = ctx.store;
  const pulled = await run(fresh, ["pull"]);
  assert.equal(pulled.code, 0, pulled.err);
  assert.equal(ledgerCount(fresh.dbPath), 3);
  assert.deepEqual(JSON.parse(readFileSync(path.join(fresh.dataDir, "geocoding-cache.json"), "utf8")), {
    "rome, it": [41.9, 12.5],
  });
});

test("pull from an empty bucket fails loudly and creates no database", async (t) => {
  const ctx = setup(t);
  const result = await run(ctx, ["pull"]);
  assert.equal(result.code, 1);
  assert.match(result.err, /holds no state/);
  assert.match(result.err, /push --init/);
  assert.equal(existsSync(ctx.dbPath), false);
});

test("push needs --init for the first generation, and --init refuses to overwrite existing state", async (t) => {
  const ctx = setup(t);
  seedLocal(ctx.dbPath, 1);

  const plain = await run(ctx, ["push"]);
  assert.equal(plain.code, 1);
  assert.match(plain.err, /holds no state/);
  assert.equal(existsSync(ctx.r2("latest.json")), false, "nothing uploaded");

  assert.equal((await run(ctx, ["push", "--init"])).code, 0);
  const again = await run(ctx, ["push", "--init"], { now: new Date("2026-11-16T02:00:00Z") });
  assert.equal(again.code, 1);
  assert.match(again.err, /already exists/);
});

test("a download that does not match the recorded sha256 is rejected and the local database is kept", async (t) => {
  const ctx = setup(t);
  seedLocal(ctx.dbPath, 2);
  assert.equal((await run(ctx, ["push", "--init"])).code, 0);

  // Same size, different bytes.
  const object = ctx.r2("state", "20261115T020000Z", "competitions.sqlite.gz");
  const bytes = readFileSync(object);
  bytes[bytes.length - 12] ^= 0xff;
  writeFileSync(object, bytes);

  const fresh = setup(t);
  fresh.env.FAKE_WRANGLER_DIR = ctx.store;
  const result = await run(fresh, ["pull"]);
  assert.equal(result.code, 1);
  assert.match(result.err, /does not match the size\/sha256/);
  assert.equal(existsSync(fresh.dbPath), false);

  // The same failure when a local database exists: it is left as it was.
  seedLocal(fresh.dbPath, 1);
  assert.equal((await run(fresh, ["pull"])).code, 1);
  assert.equal(ledgerCount(fresh.dbPath), 1);
});

test("a corrupt database inside a matching archive fails the integrity check", async (t) => {
  const ctx = setup(t);
  seedLocal(ctx.dbPath, 1);
  assert.equal((await run(ctx, ["push", "--init"])).code, 0);

  // Replace the object by a gzip of garbage and fix the recorded hash so only integrity can catch it.
  const gz = gzipSync(Buffer.alloc(8192, 7));
  writeFileSync(ctx.r2("state", "20261115T020000Z", "competitions.sqlite.gz"), gz);
  const pointerPath = ctx.r2("latest.json");
  const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
  const { createHash } = await import("node:crypto");
  pointer.db.sha256 = createHash("sha256").update(gz).digest("hex");
  pointer.db.size = gz.length;
  writeFileSync(pointerPath, JSON.stringify(pointer));

  const fresh = setup(t);
  fresh.env.FAKE_WRANGLER_DIR = ctx.store;
  const result = await run(fresh, ["pull"]);
  assert.equal(result.code, 1);
  assert.equal(existsSync(fresh.dbPath), false);
});

test("pull and push refuse to move to a state with fewer ai_notice_ledger rows unless --force", async (t) => {
  const ctx = setup(t);
  seedLocal(ctx.dbPath, 5);
  assert.equal((await run(ctx, ["push", "--init"])).code, 0);

  // A local database that lags behind the bucket: pulling is fine (it only gains rows) ...
  const lagging = setup(t);
  lagging.env.FAKE_WRANGLER_DIR = ctx.store;
  seedLocal(lagging.dbPath, 2);
  assert.equal((await run(lagging, ["pull"])).code, 0);
  assert.equal(ledgerCount(lagging.dbPath), 5);

  // ... but a local database that is ahead is not overwritten by older bucket state.
  const ahead = setup(t);
  ahead.env.FAKE_WRANGLER_DIR = ctx.store;
  seedLocal(ahead.dbPath, 9);
  const refused = await run(ahead, ["pull"]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /Refusing to overwrite/);
  assert.equal(ledgerCount(ahead.dbPath), 9);
  assert.equal((await run(ahead, ["pull", "--force"])).code, 0);
  assert.equal(ledgerCount(ahead.dbPath), 5);

  // Pushing an emptier database over the bucket state is refused as well.
  const emptier = setup(t);
  emptier.env.FAKE_WRANGLER_DIR = ctx.store;
  seedLocal(emptier.dbPath, 1);
  const pushRefused = await run(emptier, ["push"], { now: new Date("2026-11-16T02:00:00Z") });
  assert.equal(pushRefused.code, 1);
  assert.match(pushRefused.err, /Refusing to push/);
  assert.equal(JSON.parse(readFileSync(ctx.r2("latest.json"), "utf8")).generation, "20261115T020000Z");
  assert.equal((await run(emptier, ["push", "--force"], { now: new Date("2026-11-16T02:00:00Z") })).code, 0);
});

test("only the newest 14 generations are kept; older ones can be restored while listed", async (t) => {
  const ctx = setup(t);
  seedLocal(ctx.dbPath, 1, { geocode: { a: 1 } });
  const total = KEEP_GENERATIONS + 2;
  for (let day = 0; day < total; day += 1) {
    const now = new Date(Date.UTC(2026, 10, 1 + day, 2, 0, 0));
    const result = await run(ctx, day === 0 ? ["push", "--init"] : ["push"], { now });
    assert.equal(result.code, 0, result.err);
  }

  const pointer = JSON.parse(readFileSync(ctx.r2("latest.json"), "utf8"));
  assert.equal(pointer.generation, "20261116T020000Z");
  assert.equal(pointer.history.length, KEEP_GENERATIONS - 1);
  const generations = readdirSync(ctx.r2("state"));
  assert.equal(generations.length, KEEP_GENERATIONS);
  assert.ok(!generations.includes("20261101T020000Z") && !generations.includes("20261102T020000Z"));
  assert.ok(generations.includes("20261103T020000Z"));
  assert.equal(listObjects(ctx, "state").length, KEEP_GENERATIONS * 2, "db + geocode per generation");

  // Restore an older generation: it has the same ledger count here, so no --force is needed.
  const result = await run(ctx, ["pull", "--generation", "20261103T020000Z"]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Restored generation 20261103T020000Z/);
  const missing = await run(ctx, ["pull", "--generation", "20261101T020000Z"]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /not in latest\.json/);
});

test("a failed upload leaves latest.json pointing at the previous generation", async (t) => {
  const ctx = setup(t);
  seedLocal(ctx.dbPath, 1, { geocode: { a: 1 } });
  assert.equal((await run(ctx, ["push", "--init"])).code, 0);
  const before = readFileSync(ctx.r2("latest.json"), "utf8");

  const result = await run(ctx, ["push"], {
    env: { FAKE_FAIL_PUT: "geocoding-cache" },
    now: new Date("2026-11-16T02:00:00Z"),
  });
  assert.equal(result.code, 1);
  assert.match(result.err, /upload of .* failed/);
  assert.equal(readFileSync(ctx.r2("latest.json"), "utf8"), before);
});

test("stats prints counts only", async (t) => {
  const ctx = setup(t);
  seedLocal(ctx.dbPath, 4);
  const result = await run(ctx, ["stats"]);
  assert.equal(result.code, 0);
  assert.match(result.out, /^competitions=0$/m);
  assert.match(result.out, /^ai_notice_ledger=4$/m);
  assert.match(result.out, /^ai_cost_usd_today=0\.0000$/m);
});

test("the real wrangler path demands credentials by name, without printing values", async (t) => {
  const ctx = setup(t);
  seedLocal(ctx.dbPath, 1);
  const env = { PATH: process.env.PATH, ARCH_COMPETITION_OPS_DB: ctx.dbPath };
  const out = [];
  const err = [];
  const original = console.error;
  console.error = (message) => err.push(String(message));
  try {
    const code = await main(["push", "--init"], env, { log: (line) => out.push(line), repoRoot: REPO_ROOT });
    assert.equal(code, 1);
  } finally {
    console.error = original;
  }
  assert.match(err.join("\n"), /CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID/);
});

test("arguments are validated", async (t) => {
  const ctx = setup(t);
  for (const argv of [[], ["bogus"], ["pull", "--init"], ["push", "--generation", "x"], ["push", "--nope"]]) {
    const result = await run(ctx, argv);
    assert.equal(result.code, 1, argv.join(" "));
  }
});

test("push refuses to replace a backup with missing backlog rows", async (t) => {
  const ctx = setup(t);
  seedLocal(ctx.dbPath, 1);
  const db = new Database(ctx.dbPath);
  db.exec("CREATE TABLE notice_backlog(id INT); INSERT INTO notice_backlog VALUES(1)");
  assert.equal((await run(ctx, ["push", "--init"])).code, 0);
  db.exec("DELETE FROM notice_backlog");
  db.close();
  const result = await run(ctx, ["push"], { now: new Date("2026-11-16T02:00:00Z") });
  assert.equal(result.code, 1);
  assert.match(result.err, /notice_backlog/);
});
