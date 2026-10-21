// Whitespace, diacritic and jurisdiction-key normalisation helpers.
import { combiningDiacriticPattern } from "../address/patterns";

export const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

/** `United-Kingdom`, `united kingdom` and `united_kingdom` are the same key. */
export const normalizeJurisdictionKey = (value: string | null | undefined) =>
  value?.trim().toLowerCase().replace(/[\s-]+/g, "_") || null;

export const normalizeComparisonText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(combiningDiacriticPattern, "")
    .toLowerCase();

export const splitComparisonTokens = (value: string) =>
  normalizeComparisonText(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
