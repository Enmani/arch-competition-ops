// Every country the site can meet, and how to tell which one a notice means.
//
// A record's `jurisdiction` is the product's own vocabulary (41 targeted jurisdictions plus the
// generic `eu`, `europe` and `global` that multi-country sources such as TED and the Islamic
// Development Bank fall back to). The place a notice names is not limited to that list, and a
// generic jurisdiction names no place at all. This registry (data/countries.json, built by
// scripts/build-country-registry.mjs) lets the card still find the country from what the record
// says about itself: its location text, and the "Country – " lead TED puts in front of its titles.
import registry from "../data/countries.json";
import { normalizeJurisdictionKey } from "./text/normalize";

export type CountryEntry = {
  /** Normalised names in many languages, plus common aliases ("uae", "ivory coast"). */
  aliases: readonly string[];
  atlasName?: string;
  /** English short name; also the label sent to the geocoder. */
  en: string;
  iso2: string;
  iso3?: string;
  zh: string;
};

const countries: Readonly<Record<string, CountryEntry>> = registry.countries;

/** `eu`, `europe` and `global` are where a record sits when its source names no single country. */
const GENERIC_JURISDICTIONS = new Set(["eu", "europe", "global", "international", "unknown", "worldwide"]);

export const isGenericJurisdiction = (value: string | null | undefined) => {
  const key = normalizeJurisdictionKey(value);
  return key === null || GENERIC_JURISDICTIONS.has(key);
};

export const getCountryEntry = (value: string | null | undefined): CountryEntry | null => {
  const key = normalizeJurisdictionKey(value);
  return key && Object.hasOwn(countries, key) ? countries[key] : null;
};

const normalise = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const hasHan = (value: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);

/** Names that stand for more than one country in running text, whatever the registry lists. */
const AMBIGUOUS_NAMES = new Set(["congo", "guinea", "korea", "sudan", "georgia"]);

/** Shorter names ("uk", "usa", "oman") are matched only when they are the whole segment. */
const MIN_FREE_TEXT_ALIAS = 5;
const MAX_ALIAS_WORDS = 4;

type AliasIndex = {
  /** Space-separated names, matched as whole words anywhere in a segment. */
  words: Map<string, string>;
  /** Names written without spaces (Chinese, Japanese, Korean), matched as substrings. */
  unspaced: Array<[string, string]>;
  /** Every name, matched only against the whole segment. */
  whole: Map<string, string>;
};

let aliasIndex: AliasIndex | null = null;

const buildAliasIndex = (): AliasIndex => {
  const owners = new Map<string, Set<string>>();
  for (const [slug, entry] of Object.entries(countries)) {
    for (const alias of entry.aliases) {
      const owner = owners.get(alias) ?? new Set<string>();
      owner.add(slug);
      owners.set(alias, owner);
    }
  }
  const words = new Map<string, string>();
  const whole = new Map<string, string>();
  const unspaced: Array<[string, string]> = [];
  for (const [alias, slugs] of owners) {
    // A name two countries share ("congo", "guinea") says nothing alone: leave it out.
    if (slugs.size !== 1 || AMBIGUOUS_NAMES.has(alias)) {
      continue;
    }
    const [slug] = [...slugs];
    whole.set(alias, slug);
    if (hasHan(alias)) {
      if (alias.length >= 2) {
        unspaced.push([alias, slug]);
      }
    } else if (alias.length >= MIN_FREE_TEXT_ALIAS) {
      words.set(alias, slug);
    }
  }
  unspaced.sort((left, right) => right[0].length - left[0].length);
  return { unspaced, whole, words };
};

const resolveSegment = (segment: string): string | null => {
  aliasIndex ??= buildAliasIndex();
  const text = normalise(segment);
  if (!text) {
    return null;
  }
  const exact = aliasIndex.whole.get(text.replace(/[.,;:()]+$/g, "").trim());
  if (exact) {
    return exact;
  }
  const tokens = text.split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  for (let size = Math.min(MAX_ALIAS_WORDS, tokens.length); size >= 1; size -= 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      const found = aliasIndex.words.get(tokens.slice(start, start + size).join(" "));
      if (found) {
        return found;
      }
    }
  }
  if (hasHan(text)) {
    for (const [alias, slug] of aliasIndex.unspaced) {
      if (text.includes(alias)) {
        return slug;
      }
    }
  }
  return null;
};

/** TED titles read "Austria – Works for complete or part construction ...": the lead is the country. */
const titleLead = (title: string | null | undefined) => {
  const match = /^\s*([^–—]{2,40}?)\s+[–—]\s+/u.exec(title ?? "");
  return match ? match[1] : null;
};

/**
 * The country a record is about. A real country in `jurisdictionKey` wins. Otherwise (a generic
 * jurisdiction, or one outside the registry) the location text is tried segment by segment, last
 * segment first because an address ends with its country, then the title's country lead.
 * Returns the registry slug, or null when the record names no country.
 */
export const resolveOpportunityCountry = (opportunity: {
  jurisdictionKey?: string | null;
  locationLabel?: string | null;
  title?: string | null;
}): string | null => {
  const declared = normalizeJurisdictionKey(opportunity.jurisdictionKey);
  if (declared && !GENERIC_JURISDICTIONS.has(declared) && Object.hasOwn(countries, declared)) {
    return declared;
  }
  const segments = (opportunity.locationLabel ?? "").split(",").map((segment) => segment.trim()).filter(Boolean);
  for (const segment of [...segments].reverse()) {
    const found = resolveSegment(segment);
    if (found) {
      return found;
    }
  }
  const lead = titleLead(opportunity.title);
  return lead ? resolveSegment(lead) : null;
};

/** The country's name in the page language (Chinese or English), from the registry. */
export const getCountryName = (slug: string, locale: "en" | "zh"): string | null => {
  const entry = getCountryEntry(slug);
  return entry ? (locale === "zh" ? entry.zh : entry.en) : null;
};
