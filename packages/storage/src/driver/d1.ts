import { StorageError } from "./errors";
import type { D1DatabaseLike } from "./types";

/**
 * D1 driver: the Cloudflare D1 binding already has the exact shape of `D1DatabaseLike`
 * (prepare/bind/all/first/run/batch, `batch` being transactional), so no wrapping layer is
 * needed. This function only validates the binding at the boundary so a misconfigured
 * deployment fails with a diagnosable message instead of `undefined is not a function`.
 */
export const asD1Driver = (binding: unknown): D1DatabaseLike => {
  const candidate = binding as Partial<D1DatabaseLike> | null | undefined;
  if (!candidate || typeof candidate.prepare !== "function" || typeof candidate.batch !== "function") {
    throw new StorageError(
      "storage_error",
      "Cloudflare D1 binding `DB` is missing or does not expose prepare()/batch().",
    );
  }
  return candidate as D1DatabaseLike;
};
