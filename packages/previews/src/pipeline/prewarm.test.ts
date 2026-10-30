// Hermetic end-to-end test of the batch job: a real SQLite file, real sharp composition and real
// file output, with every network call answered by in-process fakes.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import sharp from "sharp";

import { loadPreviewConfig } from "../config";
import { parsePreviewManifest } from "../manifest";
import { createPipelineServices, type PipelineServices } from "./context";
import { runPrewarm } from "./prewarm";
import { acquireLock, LockHeldError } from "./store";

type Row = { id: string; sourceUrl?: string; status?: string; title: string };

const createDatabase = (file: string, rows: Row[]) => {
  const db = new Database(file);
  db.exec(`CREATE TABLE competitions (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, organizer TEXT, authority_name TEXT,
    brief_pdf_url TEXT, documents_portal_url TEXT, jurisdiction TEXT, location_label TEXT,
    official_url TEXT, source_url TEXT, geo_lat REAL, geo_lng REAL, status TEXT NOT NULL,
    deadline_at TEXT)`);
  const insert = db.prepare(
    "INSERT INTO competitions (id, title, jurisdiction, status, source_url) VALUES (?, ?, 'italy', ?, ?)",
  );
  rows.forEach((row) =>
    insert.run(row.id, row.title, row.status ?? "discovered", row.sourceUrl ?? null),
  );
  return db;
};

const noisyTile = () =>
  sharp({
    create: { channels: 3, height: 256, noise: { mean: 128, sigma: 70, type: "gaussian" }, width: 256, background: "#808080" },
  })
    .png()
    .toBuffer();

type Harness = {
  calls: { documents: number; nominatim: number; tiles: number };
  directory: string;
  services: PipelineServices;
};

const setUp = async (): Promise<Harness> => {
  const directory = await mkdtemp(path.join(tmpdir(), "previews-e2e-"));
  const tile = await noisyTile();
  const calls = { documents: 0, nominatim: 0, tiles: 0 };
  const services = createPipelineServices({
    cacheDirectory: directory,
    config: loadPreviewConfig({ ARCH_PREVIEW_CONTACT: "ops@example.org" }),
    fetch: (async (url: string) => {
      if (url.includes("nominatim")) {
        calls.nominatim += 1;
        return Response.json([
          {
            addresstype: "road",
            boundingbox: ["41.1000", "41.1010", "14.7000", "14.7010"],
            category: "highway",
            lat: "41.1005",
            lon: "14.7005",
            type: "residential",
          },
        ]);
      }
      if (url.includes("arcgisonline")) {
        calls.tiles += 1;
        return new Response(new Uint8Array(tile), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`unexpected network call: ${url}`);
    }) as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  services.documentFetcher = async () => {
    calls.documents += 1;
    return null;
  };
  return { calls, directory, services };
};

const FIXED_NOW = new Date("2026-10-21T10:00:00.000Z");
const readManifest = async (out: string) =>
  parsePreviewManifest(JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8")));

test("generates a satellite image with attribution, records it, then skips unchanged records", async () => {
  const h = await setUp();
  try {
    const databasePath = path.join(h.directory, "competitions.sqlite");
    const db = createDatabase(databasePath, [
      { id: "road-work", title: "Lavori di manutenzione in via Vitulanese 104" },
      { id: "no-clue", sourceUrl: "https://notices.example.org/n/1", title: "Generic design competition" },
    ]);
    db.close();
    const out = path.join(h.directory, "out");
    const options = { databasePath, now: () => FIXED_NOW, outputDirectory: out, prune: true };

    const first = await runPrewarm(h.services, options);
    assert.deepEqual(first, { attempted: 2, failed: 0, generated: 1, skipped: 1 });

    const manifest = await readManifest(out);
    const entry = manifest?.entries["road-work"];
    assert.ok(entry);
    assert.equal(entry.kind, "satellite");
    assert.equal(entry.algorithmVersion, "v2");
    assert.equal(entry.generatedAt, FIXED_NOW.toISOString());
    assert.match(entry.attribution ?? "", /Esri/);
    assert.ok(entry.locator && Math.abs(entry.locator.lat - 41.1005) < 1e-9);
    assert.match(entry.file ?? "", /^road-work-[0-9a-f]{10}\.jpg$/);
    assert.equal(manifest?.entries["no-clue"].kind, "none");
    assert.equal(manifest?.entries["no-clue"].file, null);

    // The image is a real 720x720 JPEG whose credit strip is darkened (the attribution bar).
    const imageFile = path.join(out, "images", entry.file as string);
    const metadata = await sharp(imageFile).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ["jpeg", 720, 720]);
    const meanOf = async (region: { height: number; left: number; top: number; width: number }) => {
      // stats() looks at the input image, so crop to a buffer first.
      const crop = await sharp(imageFile).extract(region).toBuffer();
      return (await sharp(crop).stats()).channels[0].mean;
    };
    const strip = await meanOf({ height: 20, left: 0, top: 698, width: 400 });
    const body = await meanOf({ height: 100, left: 0, top: 300, width: 400 });
    assert.ok(strip < body * 0.7, `credit bar darkens the strip (${strip} vs ${body})`);

    assert.equal(h.calls.nominatim, 1);
    assert.ok(h.calls.tiles >= 6);
    assert.equal(h.calls.documents > 0, true, "the record without a location falls back to its pages");

    // Second run: nothing changed, so nothing is fetched or generated.
    const before = { ...h.calls };
    const second = await runPrewarm(h.services, options);
    assert.deepEqual(second, { attempted: 2, failed: 0, generated: 0, skipped: 2 });
    assert.deepEqual(h.calls, before);
    assert.deepEqual(await readdir(path.join(out, "images")), [entry.file]);
  } finally {
    await rm(h.directory, { force: true, recursive: true });
  }
});

test("a changed record is regenerated and its superseded image is removed", async () => {
  const h = await setUp();
  try {
    const databasePath = path.join(h.directory, "competitions.sqlite");
    createDatabase(databasePath, [{ id: "road-work", title: "Lavori in via Vitulanese 104" }]).close();
    const out = path.join(h.directory, "out");
    const options = { databasePath, now: () => FIXED_NOW, outputDirectory: out, prune: true };

    await runPrewarm(h.services, options);
    const firstFile = (await readManifest(out))?.entries["road-work"].file;

    const db = new Database(databasePath);
    db.prepare("UPDATE competitions SET title = ? WHERE id = ?").run("Lavori in via Vitulanese 105", "road-work");
    db.close();
    const summary = await runPrewarm(h.services, options);

    const secondFile = (await readManifest(out))?.entries["road-work"].file;
    assert.equal(summary.generated, 1);
    assert.notEqual(secondFile, firstFile);
    assert.deepEqual(await readdir(path.join(out, "images")), [secondFile]);
  } finally {
    await rm(h.directory, { force: true, recursive: true });
  }
});

test("--only bypasses the skip logic for nothing, and a full run prunes records that left the list", async () => {
  const h = await setUp();
  try {
    const databasePath = path.join(h.directory, "competitions.sqlite");
    createDatabase(databasePath, [
      { id: "keep", title: "Lavori in via Vitulanese 104" },
      { id: "gone", title: "Lavori in via Vitulanese 106" },
    ]).close();
    const out = path.join(h.directory, "out");
    const options = { databasePath, now: () => FIXED_NOW, outputDirectory: out, prune: true };
    await runPrewarm(h.services, options);
    assert.equal(Object.keys((await readManifest(out))?.entries ?? {}).length, 2);

    const db = new Database(databasePath);
    db.prepare("UPDATE competitions SET status = 'archived' WHERE id = 'gone'").run();
    db.close();

    // A partial run (--only) must never prune.
    await runPrewarm(h.services, { ...options, only: ["keep"] });
    assert.equal(Object.keys((await readManifest(out))?.entries ?? {}).length, 2);

    await runPrewarm(h.services, options);
    const manifest = await readManifest(out);
    assert.deepEqual(Object.keys(manifest?.entries ?? {}), ["keep"]);
    assert.equal((await readdir(path.join(out, "images"))).length, 1);
  } finally {
    await rm(h.directory, { force: true, recursive: true });
  }
});

test("publishing mirrors the manifest and its images into the Web public directory", async () => {
  const h = await setUp();
  try {
    const databasePath = path.join(h.directory, "competitions.sqlite");
    createDatabase(databasePath, [{ id: "road-work", title: "Lavori in via Vitulanese 104" }]).close();
    const out = path.join(h.directory, "out");
    const publish = path.join(h.directory, "public", "previews");
    await mkdir(path.join(publish, "images"), { recursive: true });
    await writeFile(path.join(publish, "images", "stale-0000000000.jpg"), "old");

    const summary = await runPrewarm(h.services, {
      databasePath,
      now: () => FIXED_NOW,
      outputDirectory: out,
      prune: true,
      publishDirectory: publish,
    });

    const entry = (await readManifest(publish))?.entries["road-work"];
    assert.equal(summary.published, 1);
    assert.deepEqual(await readdir(path.join(publish, "images")), [entry?.file]);
  } finally {
    await rm(h.directory, { force: true, recursive: true });
  }
});

test("only one run may write a previews directory at a time", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "previews-lock-"));
  try {
    const release = await acquireLock(directory);
    await assert.rejects(acquireLock(directory), LockHeldError);
    await release();
    await (await acquireLock(directory))();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
