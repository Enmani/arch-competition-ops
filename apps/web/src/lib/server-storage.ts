import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  asD1Driver,
  createStorage,
  type D1DatabaseLike,
  type Storage,
  type StoredOpportunityFeedItem,
} from "@arch-competition/storage";

export type { StoredOpportunityFeedItem };

declare global {
  interface CloudflareEnv {
    DB?: D1DatabaseLike;
  }
}

/**
 * The single, type-safe way the web app obtains storage.
 *
 * - Cloudflare Workers (OpenNext) and `ARCH_COMPETITION_USE_D1_IN_DEV=1`: the `DB` D1 binding.
 * - `next dev`: better-sqlite3 on the local opportunity database (`ARCH_COMPETITION_OPS_DB`,
 *   default data/competitions.sqlite), one cached connection pair per process, migrations
 *   applied on first use.
 * Both paths run the identical storage code; there is no per-runtime copy of any query.
 *
 * The local branch is guarded by a literal `process.env.NODE_ENV === "development"` test so the
 * production bundler removes it, keeping better-sqlite3 and the filesystem out of the Worker.
 */
const d1Storages = new WeakMap<object, Storage>();

const getD1Storage = async (): Promise<Storage> => {
  const development = process.env.NODE_ENV === "development";
  let binding: unknown;
  try {
    const context = development ? await getCloudflareContext({ async: true }) : getCloudflareContext();
    binding = context.env.DB;
  } catch (error) {
    throw new Error(
      "Cloudflare bindings are unavailable. Run through the Cloudflare runtime (build:web:cloudflare / preview) or `npm run dev:web`.",
      { cause: error },
    );
  }

  const driver = asD1Driver(binding);
  let storage = d1Storages.get(driver);
  if (!storage) {
    storage = createStorage({ writer: driver });
    d1Storages.set(driver, storage);
  }
  return storage;
};

export const getStorage = async (): Promise<Storage> => {
  if (process.env.NODE_ENV === "development" && process.env.ARCH_COMPETITION_USE_D1_IN_DEV !== "1") {
    const { getLocalStorage } = await import("@arch-competition/storage/node");
    return getLocalStorage();
  }
  return getD1Storage();
};

/** Used by the opportunity image route (owned by the preview pipeline). */
export const getWebOpportunityFeedItemBySlug = async (slug: string) =>
  (await getStorage()).opportunities.getBySlug(slug);
