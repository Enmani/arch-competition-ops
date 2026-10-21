import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

/**
 * The repository root is the directory that holds AGENTS.md, config/ and
 * apps/web/migrations. Next.js dev runs with cwd = apps/web, tests with cwd = repo root, so
 * walk up from both the cwd and this file.
 */
export const findRepoRoot = () => {
  const starts = [process.cwd(), currentDirectory];
  for (const start of starts) {
    let candidate = path.resolve(start);
    for (let depth = 0; depth < 8; depth += 1) {
      if (
        existsSync(path.join(candidate, "AGENTS.md")) &&
        existsSync(path.join(candidate, "apps", "web", "migrations"))
      ) {
        return candidate;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        break;
      }
      candidate = parent;
    }
  }
  throw new Error(
    "Could not locate the repository root (expected AGENTS.md and apps/web/migrations). " +
      "Run from inside the repository or set ARCH_COMPETITION_OPS_DB explicitly.",
  );
};

export const resolveMigrationsDirectory = () => path.join(findRepoRoot(), "apps", "web", "migrations");

/**
 * Local opportunity database. `ARCH_COMPETITION_OPS_DB` is shared with the Python worker so
 * both sides always point at the same file (the former ARCH_COMPETITION_DB_PATH is gone).
 */
export const resolveLocalDatabasePath = () => {
  const configured = process.env.ARCH_COMPETITION_OPS_DB?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(findRepoRoot(), "data", "competitions.sqlite");
};
