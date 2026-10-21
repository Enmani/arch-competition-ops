import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

import Database from "better-sqlite3";

import {
  EXIT_LOCKED,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  main,
  parseArguments,
  parseCompetitionIds,
} from "./cli";
import { acquireLock } from "./pipeline/store";

test("arguments are parsed into a plain structure", () => {
  const args = parseArguments(
    ["--db", "x.sqlite", "--limit", "5", "--only", "a", "--only", "b", "--force", "--no-prune", "--publish"],
    {},
  );

  assert.equal(args.database, "x.sqlite");
  assert.equal(args.limit, 5);
  assert.deepEqual(args.only, ["a", "b"]);
  assert.equal(args.force, true);
  assert.equal(args.prune, false);
  assert.match(args.publish ?? "", /apps[\\/]web[\\/]public[\\/]previews$/);
  assert.match(args.out, /artifacts[\\/]previews$/);
});

test("--db falls back to ARCH_COMPETITION_OPS_DB; --publish accepts an explicit directory", () => {
  const args = parseArguments(["--publish", "somewhere"], { ARCH_COMPETITION_OPS_DB: "from-env.sqlite" });

  assert.equal(args.database, "from-env.sqlite");
  assert.equal(path.basename(args.publish ?? ""), "somewhere");
});

test("bad arguments raise a usage error", () => {
  for (const argv of [["--bogus"], ["--limit"], ["--limit", "x"], ["--db"], ["--db", "--force"]]) {
    assert.throws(() => parseArguments(argv, {}), UsageError, argv.join(" "));
  }
});

test("competition ids come from the worker's stdin protocol", () => {
  assert.deepEqual(parseCompetitionIds('{"competitionIds": ["a", "", 3, "b"]}'), ["a", "b"]);
  assert.throws(() => parseCompetitionIds('{"ids": []}'), UsageError);
  assert.throws(() => parseCompetitionIds("not json"));
});

const quiet = () => {
  mock.method(console, "error", () => undefined);
  const lines: string[] = [];
  mock.method(console, "log", (line: string) => lines.push(line));
  return lines;
};

test("main prints exactly one JSON line with the counts on stdout", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "previews-cli-"));
  const lines = quiet();
  try {
    const databasePath = path.join(directory, "c.sqlite");
    const db = new Database(databasePath);
    db.exec(`CREATE TABLE competitions (id TEXT PRIMARY KEY, title TEXT NOT NULL, organizer TEXT,
      authority_name TEXT, brief_pdf_url TEXT, documents_portal_url TEXT, jurisdiction TEXT,
      location_label TEXT, official_url TEXT, source_url TEXT, geo_lat REAL, geo_lng REAL,
      status TEXT NOT NULL, deadline_at TEXT)`);
    db.prepare("INSERT INTO competitions (id, title, status) VALUES ('x', 'Untraceable', 'discovered')").run();
    db.close();

    const code = await main(["--db", databasePath, "--out", path.join(directory, "out")], {});

    assert.equal(code, EXIT_OK);
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ attempted: 1, failed: 0, generated: 0, skipped: 1 }]);
  } finally {
    mock.restoreAll();
    await rm(directory, { force: true, recursive: true });
  }
});

test("main reports usage errors and a held lock with distinct exit codes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "previews-cli-"));
  quiet();
  try {
    assert.equal(await main(["--nonsense"], {}), EXIT_USAGE);
    assert.equal(await main([], { ARCH_COMPETITION_OPS_DB: "" }), EXIT_USAGE);

    const out = path.join(directory, "out");
    const release = await acquireLock(out);
    const code = await main(["--db", path.join(directory, "missing.sqlite"), "--out", out], {});
    await release();
    assert.equal(code, EXIT_LOCKED);
  } finally {
    mock.restoreAll();
    await rm(directory, { force: true, recursive: true });
  }
});
