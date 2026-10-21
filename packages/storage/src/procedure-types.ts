import registry from "../../../config/procedure-type-registry.json";

/**
 * Procedure type aliases.
 *
 * `config/procedure-type-registry.json` is the only copy of this table. It is imported as
 * JSON, so bundlers inline it at build time (workerd has no filesystem) and Node reads it
 * through the module graph. The worker keeps writing raw procedure labels from many
 * jurisdictions; this module maps them to canonical keys for filtering and display.
 */
type ProcedureTypeRegistry = {
  aliasGroups: Record<string, readonly string[]>;
  suppressedAliases: readonly string[];
};

const combiningDiacriticPattern = /[̀-ͯ]/g;
const typedRegistry = registry as ProcedureTypeRegistry;

export const compactText = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
};

export const normalizeLookupKey = (value: string | null | undefined) => {
  const compacted = compactText(value);
  if (!compacted) {
    return null;
  }
  return compacted
    .normalize("NFD")
    .replace(combiningDiacriticPattern, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

const aliasToCanonical = new Map<string, string>(
  Object.entries(typedRegistry.aliasGroups).flatMap(([canonicalKey, aliases]) =>
    aliases.flatMap((alias) => {
      const key = normalizeLookupKey(alias);
      return key ? [[key, canonicalKey] as const] : [];
    }),
  ),
);
const suppressedAliases = new Set(
  typedRegistry.suppressedAliases
    .map((alias) => normalizeLookupKey(alias))
    .filter((alias): alias is string => Boolean(alias)),
);

export const procedureAliasGroups = typedRegistry.aliasGroups;

/** Raw `procedure_type` values that should match a user's procedure filter. */
export const resolveProcedureFilterValues = (value: string): string[] => {
  const lookupKey = normalizeLookupKey(value);
  if (!lookupKey) {
    return [value];
  }
  if (suppressedAliases.has(lookupKey)) {
    return [];
  }
  const canonicalKey = aliasToCanonical.get(lookupKey);
  if (!canonicalKey) {
    return [value];
  }
  const group = typedRegistry.aliasGroups[canonicalKey];
  return group ? [...group] : [canonicalKey];
};

export type ProcedurePresentation = { key: string | null; pending: boolean };

/** Canonical key for a raw stored value; `pending` when it is missing, noisy or suppressed. */
export const resolveProcedureType = (value: string | null | undefined): ProcedurePresentation => {
  const rawValue = compactText(value);
  if (!rawValue || /[<>{}[\]"]/u.test(rawValue)) {
    return { key: null, pending: true };
  }
  const lookupKey = normalizeLookupKey(rawValue);
  if (lookupKey && suppressedAliases.has(lookupKey)) {
    return { key: null, pending: true };
  }
  if (lookupKey && aliasToCanonical.has(lookupKey)) {
    return { key: aliasToCanonical.get(lookupKey) ?? null, pending: false };
  }
  return { key: rawValue, pending: false };
};
