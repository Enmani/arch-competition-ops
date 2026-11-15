// Guards the public-repo rules of .github/workflows/daily-ingest.yml. The workflow runs with real
// secrets in a repository whose logs and artifacts are world-readable, so these are text-level
// checks on the properties that must never regress. (`yaml` is not a direct dependency of this
// repository, so the file is checked line-wise; its syntax is checked by GitHub and by actionlint
// when available.)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(path.join(ROOT, ".github", "workflows", "daily-ingest.yml"), "utf8").replace(/\r\n/g, "\n");
const LINES = WORKFLOW.split("\n");
// Comments and blank lines carry no behaviour; most checks look at code only.
const CODE = LINES.filter((line) => !/^\s*(#|$)/.test(line)).map((line) => line.replace(/\s+#.*$/, ""));

/** Keys directly below a top-level key (`on:`), by indentation. */
function childKeys(topKey) {
  const start = CODE.findIndex((line) => line === `${topKey}:`);
  assert.notEqual(start, -1, `${topKey}: block exists`);
  const keys = [];
  for (const line of CODE.slice(start + 1)) {
    if (/^\S/.test(line)) {
      break;
    }
    const match = /^ {2}([A-Za-z_-]+):/.exec(line);
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys;
}

test("triggers are schedule and workflow_dispatch only", () => {
  assert.deepEqual(childKeys("on").sort(), ["schedule", "workflow_dispatch"]);
  assert.match(WORKFLOW, /^ {4}- cron: "0 2 \* \* \*"/m, "once a day at 02:00 UTC");
  assert.doesNotMatch(CODE.join("\n"), /pull_request|workflow_run|issue_comment|\bpush:\s*$/);
});

test("manual inputs: batch_id, publication_date_from and a boolean dry_run", () => {
  const block = WORKFLOW.slice(WORKFLOW.indexOf("workflow_dispatch:"), WORKFLOW.indexOf("\npermissions:"));
  assert.match(block, /batch_id:[\s\S]*?default: all_enabled/);
  assert.match(block, /publication_date_from:/);
  assert.match(block, /dry_run:[\s\S]*?type: boolean/);
});

test("nothing is uploaded or cached as an artifact", () => {
  assert.doesNotMatch(CODE.join("\n"), /upload-artifact|download-artifact|actions\/cache|gh run download/i);
});

test("runs one at a time and never cancels a run half way", () => {
  assert.match(WORKFLOW, /^concurrency:\n {2}group: daily-ingest\n {2}cancel-in-progress: false$/m);
});

test("only the owner's repository runs it, with a job limit under GitHub's 360 minutes", () => {
  assert.match(WORKFLOW, /^ {4}if: github\.repository == 'Enmani\/arch-competition-ops'$/m);
  assert.match(WORKFLOW, /^ {4}timeout-minutes: 350\b/m);
});

test("permissions: contents read at the top, actions write only inside the job", () => {
  assert.match(WORKFLOW, /^permissions:\n {2}contents: read\n/m);
  const job = WORKFLOW.slice(WORKFLOW.indexOf("\njobs:"));
  assert.match(job, /^ {4}permissions:\n {6}contents: read\n {6}actions: write\b/m);
  assert.equal(CODE.join("\n").match(/actions: write/g).length, 1);
  assert.doesNotMatch(CODE.join("\n"), /(contents|id-token|pull-requests|packages): write/);
});

test("third-party actions are pinned to a version tag like ci.yml", () => {
  const uses = [...CODE.join("\n").matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
  assert.ok(uses.length >= 3);
  for (const reference of uses) {
    assert.match(reference, /^[\w.-]+\/[\w.-]+@v\d+(\.\d+)*$/, reference);
  }
  assert.ok(uses.includes("astral-sh/setup-uv@v6"));
});

test("only the three project secrets are used, each on the steps that need it", () => {
  const code = CODE.join("\n");
  const secrets = new Set([...code.matchAll(/secrets\.(\w+)/g)].map((match) => match[1]));
  assert.deepEqual([...secrets].sort(), ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "OPENAI_API_KEY"]);
  assert.doesNotMatch(code, /secrets\.\w+/.exec(code.split("steps:")[0]) ?? /(?!)/, "no secret at workflow or job level");
  assert.doesNotMatch(code.split("steps:")[0], /secrets\./, "no secret at workflow or job level");
  assert.doesNotMatch(code, /toJSON\(secrets\)|secrets\[/);
});

test("the run script prints no environment and no data files", () => {
  const code = CODE.join("\n");
  assert.doesNotMatch(code, /^\s*(env|printenv|set)\s*$/m);
  assert.doesNotMatch(code, /\bcat\b[^\n]*(data\/|\.sqlite|d1-sync|artifacts\/)/);
  assert.doesNotMatch(code, /set -x|ACTIONS_STEP_DEBUG/);
});

test("the sequence: pull, cleanup, repair countries, ingest, sync, push, keepalive, with the guards on each", () => {
  const code = CODE.join("\n");
  const order = [
    "cloud-state.mjs pull",
    "cleanup-expired-competitions",
    "repair-jurisdictions",
    "ingest-batch",
    "export-d1-data.mjs --apply",
    "cloud-state.mjs push",
    "actions/workflows/daily-ingest.yml/enable",
  ].map((needle) => code.indexOf(needle));
  assert.ok(order.every((index) => index > 0), "every step is present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in this order");

  // Sync and push run after a failed ingest but never after a failed pull; dry runs skip the paid
  // ingest and the D1 apply.
  assert.match(WORKFLOW, /name: Sync to D1\n {8}if: \$\{\{ always\(\) && steps\.pull\.outcome == 'success' && inputs\.dry_run != true \}\}/);
  assert.match(WORKFLOW, /name: Push state to R2\n {8}id: push\n {8}if: \$\{\{ always\(\) && steps\.pull\.outcome == 'success' \}\}/);
  assert.match(WORKFLOW, /name: Ingest batch\n {8}id: ingest\n {8}if: \$\{\{ inputs\.dry_run != true \}\}/);
  assert.match(WORKFLOW, /name: Pull state from R2\n {8}id: pull\n/);
  // The ingest step records its exit code instead of aborting the job; a final step fails the job.
  assert.match(WORKFLOW, /exit_code=\$\{PIPESTATUS\[0\]\}/);
  assert.match(WORKFLOW, /name: Fail when the ingest reported failures[\s\S]*exit 1/);
  // The keepalive can never fail the job.
  assert.match(WORKFLOW, /name: Keep the schedule alive\n {8}if: \$\{\{ always\(\) \}\}\n {8}continue-on-error: true\n {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}/);
});

test("the budget and concurrency settings are set for the cloud run", () => {
  for (const line of [
    'ARCH_COMPETITION_OPS_AI_ENABLED: "1"',
    'ARCH_COMPETITION_OPS_AI_CONCURRENCY: "8"',
    'ARCH_COMPETITION_OPS_AI_DAILY_BUDGET_USD: "15"',
    'ARCH_COMPETITION_OPS_AI_MONTHLY_BUDGET_USD: "100"',
  ]) {
    assert.ok(CODE.some((code) => code.trim() === line), line);
  }
});
