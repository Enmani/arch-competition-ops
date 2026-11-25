// Stand-in for wrangler in tests (injected through ARCH_WRANGLER_CMD). No network, no Cloudflare.
//
//   r2 object put|get|delete <bucket>/<key> [--file f]   -> files under $FAKE_WRANGLER_DIR/r2/<bucket>/<key>
//   d1 execute <db> --remote --file f                    -> runs the SQL in the SQLite file $FAKE_D1_DB
//   d1 execute <db> --remote --json --command <sql>      -> same database, wrangler-style JSON
//
// Every call is appended to $FAKE_WRANGLER_DIR/calls.log as one JSON line.
// FAKE_FAIL_FILE (substring of a d1 --file name) makes that d1 call fail like a SQL error.
// FAKE_FAIL_PUT (substring of an object key) makes that put fail.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const root = process.env.FAKE_WRANGLER_DIR;
if (!root) {
  console.error("FAKE_WRANGLER_DIR is not set");
  process.exit(2);
}
mkdirSync(root, { recursive: true });
appendFileSync(path.join(root, "calls.log"), `${JSON.stringify(args)}\n`);

const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (args[0] === "r2" && args[1] === "object") {
  const action = args[2];
  const objectPath = args[3];
  const target = path.join(root, "r2", ...objectPath.split("/"));
  if (action === "put") {
    if (process.env.FAKE_FAIL_PUT && objectPath.includes(process.env.FAKE_FAIL_PUT)) {
      fail("Upload failed: simulated outage");
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(flag("--file"), target);
  } else if (action === "get") {
    if (!existsSync(target)) {
      fail("The specified key does not exist. [code: 10007]");
    }
    copyFileSync(target, flag("--file"));
  } else if (action === "delete") {
    rmSync(target, { force: true });
    try {
      rmdirSync(path.dirname(target)); // R2 has no directories: drop the folder once its last object is gone
    } catch {
      // not empty
    }
  } else {
    fail(`unsupported r2 action ${action}`);
  }
  process.exit(0);
}

if (args[0] === "d1" && args[1] === "execute") {
  const { default: Database } = await import("better-sqlite3"); // only the d1 calls need it
  const database = new Database(process.env.FAKE_D1_DB);
  database.pragma("foreign_keys = ON"); // D1 enforces foreign keys
  try {
    const file = flag("--file");
    if (file) {
      if (process.env.FAKE_FAIL_FILE && path.basename(file).includes(process.env.FAKE_FAIL_FILE)) {
        fail("D1_ERROR: simulated SQL failure");
      }
      const beforeChanges = database.prepare("SELECT total_changes() AS n").get().n;
      database.transaction(() => database.exec(readFileSync(file, "utf8")))();
      const changes = database.prepare("SELECT total_changes() AS n").get().n - beforeChanges;
      if (args.includes("--json")) {
        console.log(
          JSON.stringify([
            {
              results: [],
              success: true,
              meta: { rows_read: changes, rows_written: changes, changes },
            },
          ]),
        );
      }
    } else {
      const rows = database.prepare(flag("--command")).all();
      console.log(JSON.stringify([{ results: rows, success: true }]));
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

fail(`unsupported wrangler call: ${args.slice(0, 3).join(" ")}`);
