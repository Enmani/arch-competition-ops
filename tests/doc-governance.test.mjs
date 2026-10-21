import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { scan } from "../scripts/doc-governance.mjs";

const NOW = new Date("2026-10-21T00:00:00Z");

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-scan-"));
  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(root, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

const doc = (fields, body = "# Title\n") => {
  const lines = Object.entries(fields).map(([key, value]) =>
    Array.isArray(value) ? `${key}:\n${value.map((item) => `  - ${item}`).join("\n")}` : `${key}: ${value}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
};
const valid = { title: "Doc", status: "done", updated_at: "2026-10-01" };

test("a valid tree passes without warnings", () => {
  const root = makeRepo({
    "docs/a.md": doc({ ...valid, related_docs: ["docs/b.md"] }, "# A\n\nSee [b](./b.md#anchor) and [site](https://example.com).\n"),
    "docs/b.md": doc(valid),
    "AGENTS.md": doc(valid),
  });
  const result = scan(root, { now: NOW });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.files, 3);
});

test("missing frontmatter, missing fields and legacy statuses are errors", () => {
  const root = makeRepo({
    "docs/none.md": "# No frontmatter\n",
    "docs/partial.md": doc({ title: "Partial", status: "done" }),
    "docs/legacy.md": doc({ ...valid, status: "已完成" }),
    "docs/date.md": doc({ ...valid, updated_at: "2026-13-45" }),
  });
  const errors = scan(root, { now: NOW }).errors.join("\n");
  assert.match(errors, /none\.md: missing frontmatter/);
  assert.match(errors, /partial\.md: missing "updated_at"/);
  assert.match(errors, /legacy\.md: invalid status/);
  assert.match(errors, /date\.md: updated_at/);
});

test("broken frontmatter references and broken links are errors; code samples are ignored", () => {
  const root = makeRepo({
    "docs/a.md": doc(
      { ...valid, related_docs: ["docs/missing.md"] },
      "# A\n\n[gone](./gone.md)\n\n`[inline](./inline.md)`\n\n```md\n[fenced](./fenced.md)\n```\n",
    ),
  });
  const errors = scan(root, { now: NOW }).errors;
  assert.equal(errors.length, 2);
  assert.match(errors.join("\n"), /referenced file not found "docs\/missing\.md"/);
  assert.match(errors.join("\n"), /broken link "\.\/gone\.md"/);
});

test("only in-progress docs go stale, and staleness is a warning", () => {
  const root = makeRepo({
    "docs/active.md": doc({ ...valid, status: "in-progress", updated_at: "2026-06-01" }),
    "docs/fresh.md": doc({ ...valid, status: "in-progress", updated_at: "2026-10-15" }),
    "docs/old-done.md": doc({ ...valid, updated_at: "2026-01-01" }),
  });
  const result = scan(root, { now: NOW, staleDays: 60 });
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /active\.md/);
});
