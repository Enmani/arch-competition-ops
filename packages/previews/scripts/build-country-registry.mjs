// Regenerates packages/previews/data/countries.json: every country the site can meet, with the
// names a notice may use for it.
//
//   npm run build:countries -w @arch-competition/previews
//
// Why this exists: a record's country decides whether it is geocoded, which outline its card draws
// and which code follows the place name. Multi-country sources (TED, the Islamic Development Bank)
// carry no single country, so it has to be read from the notice ("Place of performance Country :
// Côte d'Ivoire", `"placeOfPerformance": ["DEE06", "DEU"]`, `"country": "Uganda"`). That needs a
// table of ALL countries and their names, not the 41 jurisdictions the product targets.
//
// Names come from the platform's own CLDR data (Intl.DisplayNames) in many languages, so the table
// has no hand-typed translations; the output is committed, so builds do not depend on the Node ICU
// version. Hand-written parts are small and visible below: slugs kept from the jurisdiction
// registry, atlas names that differ from CLDR, a few extra aliases, and ISO 3166-1 alpha-3 codes
// (the form TED uses) for the countries where it matters.
//
// The output is read by the TypeScript side (placeholder outlines, card labels) and by the Python
// worker (country resolution at extraction and geocoding), so it stays plain JSON. It is written to
// packages/previews/data/countries.json and to a copy inside the worker package.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(here, "..", "data");

const LOCALES = [
  "en", "zh", "fr", "de", "es", "it", "nl", "pt", "pl", "tr", "ar", "ru", "ro", "sv", "nb", "da",
  "fi", "cs", "hu", "el", "hr", "sk", "sl", "bg", "uk", "sr", "ja", "ko", "lt", "lv", "et", "id",
  "vi", "th", "fa", "he", "hi", "sw",
];

/** Slugs of the 41 jurisdictions already in use stay exactly as they are. */
const jurisdictions = JSON.parse(readFileSync(path.join(dataDirectory, "jurisdictions.json"), "utf8"));
const slugByIso2 = new Map(
  Object.entries(jurisdictions).map(([slug, entry]) => [
    (entry.geocoderCountryCode ?? entry.code).toUpperCase(),
    slug,
  ]),
);

/** Atlas (Natural Earth) names that CLDR spells differently, by ISO 3166-1 alpha-2. */
const ATLAS_NAME_OVERRIDES = {
  AG: "Antigua and Barb.",
  AX: "Åland",
  FO: "Faeroe Is.",
  HK: "Hong Kong",
  KN: "St. Kitts and Nevis",
  KY: "Cayman Is.",
  LC: "Saint Lucia",
  MH: "Marshall Is.",
  MO: "Macao",
  PF: "Fr. Polynesia",
  ST: "São Tomé and Principe",
  TC: "Turks and Caicos Is.",
  TT: "Trinidad and Tobago",
  VA: "Vatican",
  VC: "St. Vin. and Gren.",
  BA: "Bosnia and Herz.",
  BN: "Brunei",
  CD: "Dem. Rep. Congo",
  CF: "Central African Rep.",
  CG: "Congo",
  CI: "Côte d'Ivoire",
  CV: "Cabo Verde",
  CZ: "Czechia",
  DO: "Dominican Rep.",
  EH: "W. Sahara",
  FK: "Falkland Is.",
  GQ: "Eq. Guinea",
  KP: "North Korea",
  KR: "South Korea",
  LA: "Laos",
  MK: "Macedonia",
  MM: "Myanmar",
  PS: "Palestine",
  RU: "Russia",
  SB: "Solomon Is.",
  SS: "S. Sudan",
  SY: "Syria",
  SZ: "eSwatini",
  TF: "Fr. S. Antarctic Lands",
  TL: "Timor-Leste",
  TR: "Turkey",
  TW: "Taiwan",
  US: "United States of America",
  VN: "Vietnam",
  XK: "Kosovo",
};

/** Names notices use that CLDR does not list. Matched after normalisation, so case and accents do not matter. */
const EXTRA_ALIASES = {
  AE: ["uae", "u.a.e."],
  CD: ["drc", "congo kinshasa", "democratic republic of congo", "rd congo", "rdc"],
  CG: ["congo brazzaville", "republic of the congo", "republique du congo"],
  CI: ["ivory coast", "cote d ivoire", "cote d'ivoire"],
  CZ: ["czech republic", "ceska republika"],
  GB: ["uk", "u.k.", "great britain", "england", "scotland", "wales", "northern ireland", "britain"],
  KR: ["republic of korea", "korea south"],
  MK: ["macedonia"],
  MM: ["burma"],
  NL: ["holland", "the netherlands", "nederland"],
  PS: ["state of palestine", "west bank", "gaza"],
  RU: ["russian federation"],
  SA: ["ksa", "kingdom of saudi arabia"],
  SY: ["syrian arab republic"],
  SZ: ["swaziland"],
  TR: ["turkey", "turkiye", "türkiye"],
  US: ["usa", "u.s.a.", "u.s.", "united states of america", "america"],
  VN: ["viet nam"],
};

/** ISO 3166-1 alpha-3, the form TED notices use in `placeOfPerformance`. */
const ISO3 = {
  AD: "AND", AE: "ARE", AF: "AFG", AL: "ALB", AM: "ARM", AO: "AGO", AR: "ARG", AT: "AUT", AU: "AUS",
  AZ: "AZE", BA: "BIH", BD: "BGD", BE: "BEL", BF: "BFA", BG: "BGR", BH: "BHR", BI: "BDI", BJ: "BEN",
  BO: "BOL", BR: "BRA", BW: "BWA", BY: "BLR", CA: "CAN", CD: "COD", CF: "CAF", CG: "COG", CH: "CHE",
  CI: "CIV", CL: "CHL", CM: "CMR", CN: "CHN", CO: "COL", CR: "CRI", CU: "CUB", CV: "CPV", CY: "CYP",
  CZ: "CZE", DE: "DEU", DJ: "DJI", DK: "DNK", DO: "DOM", DZ: "DZA", EC: "ECU", EE: "EST", EG: "EGY",
  ER: "ERI", ES: "ESP", ET: "ETH", FI: "FIN", FR: "FRA", GA: "GAB", GB: "GBR", GE: "GEO", GH: "GHA",
  GM: "GMB", GN: "GIN", GR: "GRC", GT: "GTM", GW: "GNB", HN: "HND", HR: "HRV", HT: "HTI", HU: "HUN",
  ID: "IDN", IE: "IRL", IL: "ISR", IN: "IND", IQ: "IRQ", IR: "IRN", IS: "ISL", IT: "ITA", JM: "JAM",
  JO: "JOR", JP: "JPN", KE: "KEN", KG: "KGZ", KH: "KHM", KR: "KOR", KW: "KWT", KZ: "KAZ", LA: "LAO",
  LB: "LBN", LI: "LIE", LK: "LKA", LR: "LBR", LT: "LTU", LU: "LUX", LV: "LVA", LY: "LBY", MA: "MAR",
  MD: "MDA", ME: "MNE", MG: "MDG", MK: "MKD", ML: "MLI", MM: "MMR", MN: "MNG", MR: "MRT", MT: "MLT",
  MV: "MDV", MW: "MWI", MX: "MEX", MY: "MYS", MZ: "MOZ", NA: "NAM", NE: "NER", NG: "NGA", NI: "NIC",
  NL: "NLD", NO: "NOR", NP: "NPL", NZ: "NZL", OM: "OMN", PA: "PAN", PE: "PER", PH: "PHL", PK: "PAK",
  PL: "POL", PS: "PSE", PT: "PRT", PY: "PRY", QA: "QAT", RO: "ROU", RS: "SRB", RU: "RUS", RW: "RWA",
  SA: "SAU", SD: "SDN", SE: "SWE", SI: "SVN", SK: "SVK", SL: "SLE", SN: "SEN", SO: "SOM", SS: "SSD",
  SV: "SLV", SY: "SYR", TD: "TCD", TG: "TGO", TH: "THA", TJ: "TJK", TM: "TKM", TN: "TUN", TR: "TUR",
  TZ: "TZA", UA: "UKR", UG: "UGA", US: "USA", UY: "URY", UZ: "UZB", VE: "VEN", VN: "VNM", XK: "XKX",
  YE: "YEM", ZA: "ZAF", ZM: "ZMB", ZW: "ZWE",
};

const normalise = (value) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const slugify = (value) => normalise(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const displayNames = new Map(LOCALES.map((locale) => [locale, new Intl.DisplayNames([locale], { type: "region" })]));
const nameIn = (locale, code) => {
  try {
    const name = displayNames.get(locale).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
};

// Atlas names, to know which countries can be drawn.
const atlas = JSON.parse(readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"));
const atlasNames = new Set(
  feature(atlas, atlas.objects.countries).features.map((item) => String(item.properties?.name ?? "")),
);
const atlasByNormalisedName = new Map([...atlasNames].map((name) => [normalise(name), name]));

const A = "A".charCodeAt(0);
const countries = {};
const used = new Set();
for (let first = 0; first < 26; first += 1) {
  for (let second = 0; second < 26; second += 1) {
    const iso2 = String.fromCharCode(A + first, A + second);
    // CLDR answers deprecated codes (DD, AN, BU, ...) with the modern country's name; only the
    // current code is a country of its own.
    if (Intl.getCanonicalLocales(`und-${iso2}`)[0] !== `und-${iso2}`) {
      continue;
    }
    const english = nameIn("en", iso2);
    // CLDR also lists groupings and reserved codes ("European Union", "Unknown Region"): skip them.
    if (!english || /^(unknown|european union|united nations|eurozone|outlying|latin america|world|africa|americas|asia|europe|oceania|antarctica$)/i.test(english)) {
      continue;
    }
    // Two codes can share a spelling after normalisation (CW and CC both read "curacao" in some
    // locales); the later one gets its code appended, so slugs stay unique and stable.
    let slug = slugByIso2.get(iso2) ?? slugify(english);
    if (used.has(slug)) {
      slug = `${slug}_${iso2.toLowerCase()}`;
    }
    used.add(slug);

    const names = new Set();
    for (const locale of LOCALES) {
      const name = nameIn(locale, iso2);
      if (name) {
        names.add(normalise(name));
      }
    }
    for (const alias of EXTRA_ALIASES[iso2] ?? []) {
      names.add(normalise(alias));
    }

    const atlasName =
      ATLAS_NAME_OVERRIDES[iso2] ?? atlasByNormalisedName.get(normalise(english)) ?? null;
    countries[slug] = {
      aliases: [...names].sort(),
      ...(atlasName && atlasNames.has(atlasName) ? { atlasName } : {}),
      // Straight apostrophe: the same string a geocoder or a person types.
      en: english.replace(/’/g, "'"),
      iso2,
      ...(ISO3[iso2] ? { iso3: ISO3[iso2] } : {}),
      zh: nameIn("zh", iso2) ?? english,
    };
  }
}

// The registry's own entry beats a CLDR spelling for the countries the product already names.
for (const [slug, entry] of Object.entries(jurisdictions)) {
  if (countries[slug]) {
    for (const alias of entry.comparisonNames ?? []) {
      const normalised = normalise(alias);
      if (!countries[slug].aliases.includes(normalised)) {
        countries[slug].aliases.push(normalised);
      }
    }
    countries[slug].aliases.sort();
  }
}

const missing = [...atlasNames].filter(
  (name) => !Object.values(countries).some((entry) => entry.atlasName === name),
);
const output = `${JSON.stringify({ countries, generatedFrom: "Intl.DisplayNames (CLDR) and world-atlas countries-50m" }, null, 1)}\n`;
writeFileSync(path.join(dataDirectory, "countries.json"), output);
// The Python worker reads the same table as package data (no guessing where the repository is);
// a worker test fails if the two copies ever differ.
writeFileSync(
  path.join(here, "..", "..", "..", "apps", "worker", "src", "arch_competition_ops", "data", "countries.json"),
  output,
);
console.log(
  `countries: ${Object.keys(countries).length}, with outline: ${Object.values(countries).filter((entry) => entry.atlasName).length}`,
);
if (missing.length > 0) {
  console.log(`atlas shapes without a country (add an ATLAS_NAME_OVERRIDES entry if one matters): ${missing.join(", ")}`);
}
