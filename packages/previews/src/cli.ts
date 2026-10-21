// Command line entry of the preview generator (see bin/prewarm.mjs).
//
//   node packages/previews/bin/prewarm.mjs --db data/competitions.sqlite [--limit N] [--only ID]...
//        [--only-from-stdin] [--out DIR] [--publish [DIR]] [--force] [--no-prune]
//        [--retry-none-days N]
//
// --out defaults to ARCH_PREVIEWS_DIR, then <repo>/artifacts/previews (the Web app reads the same).
// stdout carries exactly one JSON line with the counts; progress and warnings go to stderr. The
// Python worker relies on that contract (apps/worker/.../card_previews.py).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hasConfiguredContact, loadPreviewConfig } from "./config";
import { createPipelineServices } from "./pipeline/context";
import { runPrewarm } from "./pipeline/prewarm";
import { LockHeldError } from "./pipeline/store";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_LOCKED = 75;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export type CliArguments = {
  database: string | null;
  force: boolean;
  help: boolean;
  limit?: number;
  only: string[];
  onlyFromStdin: boolean;
  out: string;
  prune: boolean;
  publish: string | null;
  retryNoneDays?: number;
};

const USAGE = `usage: prewarm.mjs --db <sqlite file> [--limit N] [--only ID]... [--only-from-stdin]
                  [--out DIR] [--publish [DIR]] [--force] [--no-prune] [--retry-none-days N]`;

export class UsageError extends Error {}

const positiveInteger = (flag: string, value: string | undefined) => {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed < 0) {
    throw new UsageError(`${flag} needs a non-negative integer`);
  }
  return parsed;
};

export const parseArguments = (argv: string[], env: NodeJS.ProcessEnv): CliArguments => {
  const result: CliArguments = {
    database: env.ARCH_COMPETITION_OPS_DB ?? null,
    force: false,
    help: false,
    only: [],
    onlyFromStdin: false,
    out: env.ARCH_PREVIEWS_DIR ? path.resolve(env.ARCH_PREVIEWS_DIR) : path.join(repoRoot, "artifacts", "previews"),
    prune: true,
    publish: null,
  };
  const valueOf = (index: number, flag: string) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new UsageError(`${flag} needs a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--db":
        result.database = valueOf(index, flag);
        index += 1;
        break;
      case "--out":
        result.out = path.resolve(valueOf(index, flag));
        index += 1;
        break;
      case "--limit":
        result.limit = positiveInteger(flag, argv[index + 1]);
        index += 1;
        break;
      case "--retry-none-days":
        result.retryNoneDays = positiveInteger(flag, argv[index + 1]);
        index += 1;
        break;
      case "--only":
        result.only.push(valueOf(index, flag));
        index += 1;
        break;
      case "--publish": {
        const next = argv[index + 1];
        if (next && !next.startsWith("--")) {
          result.publish = path.resolve(next);
          index += 1;
        } else {
          result.publish = path.join(repoRoot, "apps", "web", "public", "previews");
        }
        break;
      }
      case "--only-from-stdin":
        result.onlyFromStdin = true;
        break;
      case "--force":
        result.force = true;
        break;
      case "--no-prune":
        result.prune = false;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
      default:
        throw new UsageError(`unknown argument: ${flag}`);
    }
  }
  return result;
};

const readStdin = async () => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

/** stdin carries `{"competitionIds": [...]}`, the protocol the Python worker speaks. */
export const parseCompetitionIds = (text: string): string[] => {
  const parsed = JSON.parse(text) as { competitionIds?: unknown };
  if (!Array.isArray(parsed.competitionIds)) {
    throw new UsageError('stdin must be {"competitionIds": [...]}');
  }
  return parsed.competitionIds.filter((id): id is string => typeof id === "string" && id !== "");
};

const loadLocalEnv = () => {
  // Does not override variables that are already set (process.loadEnvFile semantics).
  for (const file of [path.join(repoRoot, ".env"), path.join(repoRoot, "apps", "web", ".env.local")]) {
    if (existsSync(file)) {
      try {
        process.loadEnvFile(file);
      } catch {
        // an unreadable env file is not fatal; missing keys just disable optional providers
      }
    }
  }
};

export const main = async (argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> => {
  let args: CliArguments;
  try {
    args = parseArguments(argv, env);
    if (args.help) {
      console.error(USAGE);
      return EXIT_OK;
    }
    if (!args.database) {
      throw new UsageError("--db is required");
    }
    if (args.onlyFromStdin) {
      args.only.push(...parseCompetitionIds(await readStdin()));
      if (args.only.length === 0) {
        console.log(JSON.stringify({ attempted: 0, failed: 0, generated: 0, skipped: 0 }));
        return EXIT_OK;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return EXIT_USAGE;
  }

  loadLocalEnv();
  const config = loadPreviewConfig(env);
  if (!hasConfiguredContact(config)) {
    console.error(
      "warning: ARCH_PREVIEW_CONTACT is not set; the public Nominatim/Photon policies require a contact address in the User-Agent.",
    );
  }
  const log = (event: string, details?: Record<string, unknown>) => {
    if (config.debug || event.endsWith("failed") || event === "record-failed") {
      console.error(`[previews] ${event}`, details ? JSON.stringify(details) : "");
    }
  };

  try {
    const services = createPipelineServices({ cacheDirectory: args.out, config, log });
    const summary = await runPrewarm(services, {
      databasePath: path.resolve(args.database),
      force: args.force,
      limit: args.limit,
      only: args.only.length > 0 ? args.only : undefined,
      outputDirectory: args.out,
      prune: args.prune,
      publishDirectory: args.publish ?? undefined,
      retryNoneDays: args.retryNoneDays,
    });
    console.log(JSON.stringify(summary));
    return summary.attempted > 0 && summary.failed === summary.attempted ? EXIT_FAILED : EXIT_OK;
  } catch (error) {
    if (error instanceof LockHeldError) {
      console.error(error.message);
      return EXIT_LOCKED;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return EXIT_FAILED;
  }
};
