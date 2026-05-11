import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import type { StoredOpportunityFeedItem } from "@arch-competition/storage/cloudflare";

import { pickOpportunityExplicitCity } from "./opportunity-location";
import {
  getSatellitePreviewStaticFileName,
  sanitizeSatellitePreviewFileName,
  satellitePreviewCacheVersion as previewCacheVersion,
} from "./opportunity-satellite-preview-cache";

type SatellitePreviewInput = Pick<
  StoredOpportunityFeedItem,
  | "authorityName"
  | "briefPdfUrl"
  | "documentsPortalUrl"
  | "jurisdictionKey"
  | "jurisdictionLabel"
  | "locationLabel"
  | "officialUrl"
  | "slug"
  | "sourceUrl"
  | "title"
>;

type AddressCandidateKind = "street_address" | "street" | "locality" | "site";

type AddressCandidate = {
  address: string;
  kind: AddressCandidateKind;
  localityHint: string | null;
  source: "page" | "title";
};

type OpportunityPageLocationSignals = {
  pdfCandidates: Array<{ score: number; url: string }>;
  structuredCandidates: AddressCandidate[];
  textCandidates: AddressCandidate[];
};

type StructuredAddressRecord = {
  country: string | null;
  locality: string | null;
  placename: string | null;
  postalCode: string | null;
  region: string | null;
  streetAddress: string | null;
};

type GeocodeCacheEntry = {
  lat: number;
  lng: number;
} | null;

type GeocodeResult = {
  lat: number;
  lng: number;
};

type NominatimSearchResult = {
  address?: Record<string, string>;
  addresstype?: string;
  boundingbox?: string[];
  category?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  type?: string;
};

type PhotonFeature = {
  geometry?: {
    coordinates?: number[];
  };
  properties?: {
    city?: string;
    country?: string;
    county?: string;
    district?: string;
    housenumber?: string;
    locality?: string;
    name?: string;
    state?: string;
    street?: string;
  };
};

type PhotonSearchResult = {
  features?: PhotonFeature[];
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const imageContentType = "image/jpeg";
const satelliteImageSize = 720;
const satelliteTileSize = 256;
const satelliteZoomWithStreetNumber = 18;
const satelliteZoomWithoutStreetNumber = 17;
const satelliteZoomWithLocality = 16;
const stadtZurichHosts = ["stadt-zuerich.ch"];
const htmlRequestTimeoutMs = 7000;
const pdfRequestTimeoutMs = 12000;
const pdfTextExtractionTimeoutMs = 15000;
const tileRequestTimeoutMs = 8000;
const geocodeRequestTimeoutMs = 12000;
const pdfMaxBytes = 12 * 1024 * 1024;
const pdfMaxCandidateUrlsPerOpportunity = 3;
const pdfMaxExtractedTextLength = 24000;
const pdfTextExtractionMaxBuffer = 512 * 1024;
const nominatimSearchUrl =
  process.env.ARCH_SATELLITE_GEOCODER_URL?.trim() ||
  "https://nominatim.openstreetmap.org/search";
const photonSearchUrl =
  process.env.ARCH_SATELLITE_PHOTON_URL?.trim() ||
  "https://photon.komoot.io/api";
const satelliteTileUrlTemplate =
  process.env.ARCH_SATELLITE_TILE_URL_TEMPLATE?.trim() ||
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const countryCodeByJurisdiction: Record<string, string> = {
  austria: "at",
  belgium: "be",
  bulgaria: "bg",
  canada: "ca",
  china: "cn",
  croatia: "hr",
  czechia: "cz",
  denmark: "dk",
  estonia: "ee",
  finland: "fi",
  france: "fr",
  germany: "de",
  greece: "gr",
  hungary: "hu",
  ireland: "ie",
  italy: "it",
  latvia: "lv",
  lithuania: "lt",
  luxembourg: "lu",
  netherlands: "nl",
  new_zealand: "nz",
  norway: "no",
  poland: "pl",
  portugal: "pt",
  romania: "ro",
  serbia: "rs",
  slovakia: "sk",
  slovenia: "si",
  spain: "es",
  sweden: "se",
  switzerland: "ch",
  "united-kingdom": "gb",
  united_kingdom: "gb",
};
const combiningDiacriticPattern = /[\u0300-\u036f]/g;
const streetNumberBodyPattern = String.raw`\d[\p{L}\p{N}]*(?:\s*(?:[-/]\s*)\d[\p{L}\p{N}]*){0,2}`;
const streetNumberPattern = new RegExp(
  String.raw`\b(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)?${streetNumberBodyPattern}\b`,
  "iu",
);
const addressPrefixPattern = String.raw`(?:c\/|c\.|via|viale|piazza|piazzale|corso|largo|vicolo|lungomare|strada|street|road|drive|lane|way|boulevard|avenue|avenida|avda\.?|av\.|rue|route|allee|gasse|platz|strasse|straße|calle|camino|carretera|ruta|plaza|paseo|ronda|rua|travessa|estrada|pra[çc]a|cal[çc]ada|rotunda|marginal|laan|plein|gracht|kade|singel|dreef|steiger|ul\.?|ulica|ulice|aleja|al\.?|bd\.?|bulevard(?:ul)?|bulvar|bulevar|str\.?|calea|sos\.?|șos\.?|ул\.?)`;
const addressBodyPattern = String.raw`[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,7}`;
const localityPrefixPattern =
  String.raw`(?:località|localita|barrio|bairro|quartiere|frazione|hamlet|village|neighbourhood|neighborhood|suburb|district|distrito|urbanizaci[oó]n|freguesia|wijk|stadsdeel|bydel|campus)`;
const placeNamePattern = String.raw`[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,5}`;
const localityWrapperStripPattern =
  /^(?:barrio|bairro|quartiere|frazione|hamlet|village|neighbourhood|neighborhood|suburb|district|distrito|urbanizaci[oó]n|freguesia|wijk|stadsdeel|bydel)\s+/iu;
const sitePrefixPattern = String.raw`(?:campus)`;
const siteBodyPattern = String.raw`[\p{L}\p{N}.'’/-]+(?:\s+(?:di|de|del|de la|de los|of)\s+)?(?:[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,5})`;
const trailingStreetTypePattern =
  String.raw`(?:straat|laan|plein|gracht|kade|singel|dreef|gade|gata|gatan|gate|torv|torget|plass|plassen|vei|veien|veg|vegen|v[aä]g|v[aä]gen|weg|ring|damm|ufer|allee|pfad|stieg|steig|tie|katu|kuja|polku|cesta|strasse|straße|ulica|n[aá]m[ěe]st[ií]|trg|utca)`;
const compoundTrailingStreetWordPattern =
  String.raw`[\p{L}\p{N}.'’/-]+${trailingStreetTypePattern}`;
const multiWordCompoundTrailingStreetPattern =
  String.raw`[\p{L}\p{N}.'’/-]+\s+[\p{L}\p{N}.'’/-]+${trailingStreetTypePattern}`;
const spacedTrailingStreetPattern =
  String.raw`[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,4}\s+${trailingStreetTypePattern}`;
const trailingStreetAddressPattern = String.raw`(?:${multiWordCompoundTrailingStreetPattern}|${spacedTrailingStreetPattern}|${compoundTrailingStreetWordPattern})`;
const compoundAddressPattern = new RegExp(
  String.raw`^(${addressPrefixPattern}\s+${addressBodyPattern})\s+(?:con|with)\s+(${addressPrefixPattern}\s+${addressBodyPattern})$`,
  "iu",
);
const referencedAddressPattern = new RegExp(
  String.raw`\b(?:a|to|towards|verso)\s+(${addressPrefixPattern}\s+${addressBodyPattern})$`,
  "iu",
);
const streetPrefixForGeocoderStripPattern = new RegExp(
  String.raw`^(?:c\/|c\.|via|viale|piazza|piazzale|corso|largo|vicolo|lungomare|strada|street|road|drive|lane|way|boulevard|avenue|avenida|avda\.?|av\.|rue|route|allee|gasse|platz|strasse|straße|calle|camino|carretera|ruta|plaza|paseo|ronda|rua|travessa|estrada|pra[çc]a|cal[çc]ada|rotunda|marginal|laan|plein|gracht|kade|singel|dreef|steiger|ul\.?|ulica|ulice|aleja|al\.?|bd\.?|bulevard(?:ul)?|bulvar|bulevar|str\.?|calea|sos\.?|șos\.?|ул\.?)\s+`,
  "iu",
);
const addressCandidatePatterns: Array<{ kind: AddressCandidateKind; pattern: RegExp }> = [
  {
    kind: "street_address",
    pattern: new RegExp(
      String.raw`\b${addressPrefixPattern}\s+${addressBodyPattern}(?:\s*,\s*|\s+)(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)?${streetNumberBodyPattern}\b`,
      "giu",
    ),
  },
  {
    kind: "street_address",
    pattern: new RegExp(
      String.raw`\b${addressPrefixPattern}\s+${addressBodyPattern}(?:\s*,\s*|\s+)snc\b`,
      "giu",
    ),
  },
  {
    kind: "street_address",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])${trailingStreetAddressPattern}(?:\s*,\s*|\s+)(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)?${streetNumberBodyPattern}\b`,
      "giu",
    ),
  },
  {
    kind: "street",
    pattern: new RegExp(
      String.raw`\b${addressPrefixPattern}\s+${addressBodyPattern}(?=(?:\s*,\s*(?:${localityPrefixPattern}\s+${placeNamePattern}|en\s+${placeNamePattern}|${placeNamePattern}(?:\s*\([A-Z]{2}\))?))|(?:\s+en\s+${placeNamePattern})|(?:\s*-\s*${placeNamePattern}\s*\([A-Z]{2}\))|[.;]|$)`,
      "giu",
    ),
  },
  {
    kind: "street",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])${spacedTrailingStreetPattern}(?=(?:\s*,\s*(?:${localityPrefixPattern}\s+${placeNamePattern}|${placeNamePattern}(?:\s*\([A-Z]{2}\))?))|(?:\s+(?:en|w|v|u)\s+${placeNamePattern})|(?:\s*-\s*${placeNamePattern}\s*\([A-Z]{2}\))|[.;]|$)`,
      "giu",
    ),
  },
  {
    kind: "locality",
    pattern: new RegExp(
      String.raw`\b(?:località|localita)\s+${placeNamePattern}(?=(?:\s+lungo\b)|(?:\s+al\s+km\b)|(?:\s+sito\b)|[.,;]|$)`,
      "giu",
    ),
  },
  {
    kind: "site",
    pattern: new RegExp(
      String.raw`\b${sitePrefixPattern}\s+${siteBodyPattern}(?=(?:\s*,\s*${placeNamePattern})|(?:\s+di\s+${placeNamePattern})|(?:\s+de\s+${placeNamePattern})|[.,;)]|$)`,
      "giu",
    ),
  },
];
const rejectedAddressMarkers =
  /\b(?:cup|cig|codice|missione|lotto|pnrr|investimento|procedura|intervento|progetto|servizio|lavori|adeguamento|bando|pratica)\b/iu;
const rejectedAddressCandidatePattern =
  /^(?:c\.?\s*\d+|art\.?\s*\d+|co\.?\s*\d+|comma\s+\d+|lett\.?\s*[a-z]|strasse\s+\d[\p{L}\p{N}/-]*|straße\s+\d[\p{L}\p{N}/-]*)$/iu;
const rejectedLocalityMarkers =
  /\b(?:esta localidad|questa località|this locality|questo comune|distrito suroeste de esta localidad)\b/iu;
const rejectedGeocodeAddressTypes = new Set([
  "city",
  "county",
  "country",
  "municipality",
  "postcode",
  "province",
  "region",
  "state",
  "town",
]);
const acceptedExactGeocodeAddressTypes = new Set([
  "amenity",
  "building",
  "commercial",
  "construction",
  "farm",
  "hamlet",
  "hospital",
  "house",
  "industrial",
  "isolated_dwelling",
  "locality",
  "neighbourhood",
  "neighborhood",
  "office",
  "residential",
  "retail",
  "road",
  "school",
  "service",
  "square",
  "suburb",
  "village",
]);
const acceptedGeocodeCategories = new Set(["building", "highway", "landuse", "place"]);
const acceptedSiteGeocodeCategories = new Set(["amenity", "building", "landuse"]);
const streetComparisonNoiseTokens = new Set([
  "a",
  "al",
  "aleja",
  "allee",
  "and",
  "at",
  "av",
  "avenida",
  "avenue",
  "avda",
  "bd",
  "boulevard",
  "bulevar",
  "bulevard",
  "bulvar",
  "c",
  "calle",
  "calcada",
  "calea",
  "camino",
  "carretera",
  "cesta",
  "con",
  "corso",
  "da",
  "das",
  "de",
  "del",
  "des",
  "di",
  "do",
  "dos",
  "dreef",
  "drive",
  "e",
  "el",
  "en",
  "estrada",
  "et",
  "gade",
  "gasse",
  "gata",
  "gatan",
  "gate",
  "gracht",
  "i",
  "in",
  "kade",
  "kuja",
  "la",
  "laan",
  "lane",
  "largo",
  "lungomare",
  "marginal",
  "na",
  "nel",
  "no",
  "of",
  "pa",
  "paseo",
  "piazza",
  "piazzale",
  "plaza",
  "platz",
  "plein",
  "polku",
  "praca",
  "praça",
  "road",
  "ronda",
  "rotunda",
  "route",
  "rua",
  "rue",
  "ruta",
  "singel",
  "sos",
  "square",
  "ste",
  "steiger",
  "str",
  "strada",
  "strasse",
  "straße",
  "street",
  "te",
  "tie",
  "torget",
  "torv",
  "travessa",
  "u",
  "ul",
  "ulica",
  "ulice",
  "utca",
  "v",
  "veg",
  "vegen",
  "vei",
  "veien",
  "via",
  "viale",
  "vicolo",
  "w",
  "way",
]);
const countryComparisonVariantsByJurisdiction: Record<string, string[]> = {
  austria: ["austria", "osterreich"],
  belgium: ["belgium", "belgique", "belgie"],
  bulgaria: ["bulgaria", "balgariya"],
  canada: ["canada"],
  china: ["china", "zhongguo"],
  croatia: ["croatia", "hrvatska"],
  czechia: ["czechia", "czech republic", "cesko"],
  denmark: ["denmark", "danmark"],
  estonia: ["estonia", "eesti"],
  finland: ["finland", "suomi"],
  france: ["france"],
  germany: ["germany", "deutschland"],
  greece: ["greece", "ellada"],
  hungary: ["hungary", "magyarorszag"],
  ireland: ["ireland", "eire"],
  italy: ["italy", "italia"],
  latvia: ["latvia", "latvija"],
  lithuania: ["lithuania", "lietuva"],
  luxembourg: ["luxembourg", "letzebuerg"],
  netherlands: ["netherlands", "nederland"],
  new_zealand: ["new zealand", "aotearoa"],
  norway: ["norway", "norge"],
  poland: ["poland", "polska"],
  portugal: ["portugal"],
  romania: ["romania"],
  serbia: ["serbia", "srbija"],
  slovakia: ["slovakia", "slovensko"],
  slovenia: ["slovenia", "slovenija"],
  spain: ["spain", "espana"],
  sweden: ["sweden", "sverige"],
  switzerland: ["switzerland", "schweiz", "suisse", "svizzera"],
  "united-kingdom": ["united kingdom", "great britain", "britain", "uk"],
  united_kingdom: ["united kingdom", "great britain", "britain", "uk"],
};

const satellitePreviewMemoryCache = new Map<string, Buffer | null>();
const geocodeMemoryCache = new Map<string, GeocodeCacheEntry>();
let geocodeCacheLoaded = false;
let geocodeLastRequestAt = 0;

const resolveRepoRoot = () => {
  const cwd = process.cwd();
  const candidates = [
    cwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "../.."),
    path.resolve(cwd, "../../.."),
    path.resolve(currentDirectory, "../../.."),
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "AGENTS.md")) && existsSync(path.join(candidate, "artifacts"))) {
      return candidate;
    }
  }

  return path.resolve(currentDirectory, "../../..");
};

const previewRoot = path.join(resolveRepoRoot(), "artifacts", "opportunity-card-satellite");
const previewImageDirectory = path.join(previewRoot, "images");
const geocodeCachePath = path.join(previewRoot, "geocode-cache.json");

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const decodeNumericHtmlEntity = (rawValue: string, radix: 10 | 16, fallback: string) => {
  const codePoint = Number.parseInt(rawValue, radix);
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
    return fallback;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
};

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => decodeNumericHtmlEntity(code, 16, match))
    .replace(/&#([0-9]+);/g, (match, code) => decodeNumericHtmlEntity(code, 10, match));

const decodeJsEscapes = (value: string) =>
  value
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\u([0-9a-f]{4})/gi, (match, code) => decodeNumericHtmlEntity(code, 16, match));

const normalizePdfScoreText = (value: string) =>
  normalizeWhitespace(decodeJsEscapes(decodeHtmlEntities(value)).replace(/[_-]+/g, " "));

const stripHtmlToText = (value: string) =>
  normalizeWhitespace(
    decodeHtmlEntities(
      value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );

const parseTagAttributes = (tag: string) => {
  const attributes: Record<string, string> = {};

  for (const match of tag.matchAll(
    /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )) {
    const [, rawName, doubleQuoted, singleQuoted, bareValue] = match;
    const rawValue = doubleQuoted ?? singleQuoted ?? bareValue ?? "";
    attributes[rawName.toLowerCase()] = decodeHtmlEntities(rawValue);
  }

  return attributes;
};

const rejectedPdfUrlMarkers =
  /\b(?:terms?|conditions?|privacy|cookie|gdpr|nutzungsbedingungen|datenschutz|impressum|legal|accessibility|hilfe|help)\b/iu;
const strongPreferredPdfUrlMarkers =
  /\b(?:lageplan|site\s*plan|situationsplan|planimetr(?:ia|y)|amtlicher\s+lageplan|projektgrenzen|masterplan)\b/iu;
const preferredPdfUrlMarkers =
  /\b(?:lageplan|site\s*plan|situation|situationsplan|planimetr(?:ia|y)|plano|plan|projektgrenzen|proyecto|project|brief|beschreibung|leistungsbeschreibung|memoria|sudgel[aä]nde|s[úu]dgel[aä]nde|lokhalle|campus|masterplan)\b/iu;
const trailingAddressFieldStopPattern =
  /\s+(?:projektnummer|quartier|grundst[üu]cksnummer|wirtschaftseinheit|baujahr|bautyp|bgf|bestand|potenzial|objekt(?:daten)?|adresse|flurst[üu]ck|flurst[üu]cksnummer|bezirk|plan(?:nummer|-nummer|nr)?|maßstab|datum|leistungsumfang|dates?\s+and\s+deadlines|period|expiration(?:\s+time)?|seite)\s*[:=-]?[\s\S]*$/iu;
const localityTailNoisePattern =
  /\b(?:projektnummer|quartier|grundst[üu]cksnummer|wirtschaftseinheit|baujahr|bautyp|bgf|bestand|potenzial|objekt(?:daten)?|adresse|flurst[üu]ck|flurst[üu]cksnummer|plan(?:nummer|-nummer|nr)?|maßstab|datum|leistungsumfang|period|expiration|seite)\b/iu;

const extractPdfUrlsFromText = (value: string, baseUrl: string) => {
  const pdfCandidates: Array<{ score: number; url: string }> = [];
  const scores = new Map<string, number>();
  const normalizeRawUrl = (rawUrl: string | null | undefined) =>
    rawUrl
      ?.trim()
      .replace(/^['"\\]+|['"\\]+$/g, "")
      .replace(/\\\//g, "/")
      .replace(/^&quot;|&quot;$/gi, "") ?? "";
  const pushCandidate = (rawUrl: string | null | undefined, contextText: string) => {
    const resolvedCandidate = resolveUrlAgainstBase(normalizeRawUrl(rawUrl), baseUrl);
    if (!resolvedCandidate) {
      return;
    }

    if (!isPdfLikeUrl(resolvedCandidate) && !/\.pdf\b/iu.test(contextText)) {
      return;
    }

    if (rejectedPdfUrlMarkers.test(decodeHtmlEntities(`${resolvedCandidate} ${contextText}`))) {
      return;
    }

    const decodedContext = normalizePdfScoreText(contextText);
    const decodedUrl = normalizePdfScoreText(resolvedCandidate);
    const score =
      (strongPreferredPdfUrlMarkers.test(decodedContext) ? 4 : 0) +
      (strongPreferredPdfUrlMarkers.test(decodedUrl) ? 2 : 0) +
      (preferredPdfUrlMarkers.test(decodedContext) ? 2 : 0) +
      (preferredPdfUrlMarkers.test(decodedUrl) ? 1 : 0);
    const previousScore = scores.get(resolvedCandidate) ?? Number.NEGATIVE_INFINITY;
    if (score <= previousScore) {
      return;
    }

    scores.set(resolvedCandidate, score);
  };

  for (const match of value.matchAll(
    /href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([^<]{0,240})/giu,
  )) {
    const rawUrl = match[1] ?? match[2] ?? match[3] ?? "";
    const contextText = decodeHtmlEntities(match[4] ?? "");
    pushCandidate(rawUrl, contextText);
  }

  for (const match of value.matchAll(/https?:\/\/[^\s"'<>\\]+/giu)) {
    pushCandidate(match[0], match[0]);
  }

  for (const match of value.matchAll(
    /href\\?=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([^<]{0,240})/giu,
  )) {
    const rawUrl = match[1] ?? match[2] ?? match[3] ?? "";
    const contextText = decodeHtmlEntities(match[4] ?? "");
    pushCandidate(rawUrl, contextText);
  }

  scores.forEach((score, url) => {
    pdfCandidates.push({ score, url });
  });

  return pdfCandidates;
};

const extractPdfUrlsFromHtml = (html: string, baseUrl: string) => {
  const candidateScores = new Map<string, number>();
  const pushCandidate = (value: string | null | undefined) => {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      /^(?:javascript:|mailto:|tel:|#)/iu.test(value)
    ) {
      return;
    }

    const resolvedCandidate = resolveUrlAgainstBase(value, baseUrl);
    if (!resolvedCandidate || !isPdfLikeUrl(resolvedCandidate)) {
      return;
    }

    if (rejectedPdfUrlMarkers.test(decodeHtmlEntities(resolvedCandidate))) {
      return;
    }

    const decodedUrl = decodeHtmlEntities(resolvedCandidate);
    const score =
      (strongPreferredPdfUrlMarkers.test(decodedUrl) ? 3 : 0) +
      (preferredPdfUrlMarkers.test(decodedUrl) ? 1 : 0);
    const previousScore = candidateScores.get(resolvedCandidate) ?? Number.NEGATIVE_INFINITY;
    if (score > previousScore) {
      candidateScores.set(resolvedCandidate, score);
    }
  };

  for (const match of html.matchAll(/<(?:a|link|iframe|embed|object)\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const rawCandidates = [
      attributes.href,
      attributes.src,
      attributes["data-href"],
      attributes["data-url"],
      attributes.data,
    ];

    for (const rawCandidate of rawCandidates) {
      pushCandidate(rawCandidate);
    }
  }

  const scriptText = decodeJsEscapes(decodeHtmlEntities(html));
  extractPdfUrlsFromText(scriptText, baseUrl).forEach(({ score, url }) => {
    const previousScore = candidateScores.get(url) ?? Number.NEGATIVE_INFINITY;
    if (score > previousScore) {
      candidateScores.set(url, score);
    }
  });

  return [...candidateScores.entries()]
    .map(([url, score]) => ({ score, url }))
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))
    .map((entry) => entry.url);
};

const getHostname = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const hostMatches = (hostname: string, patterns: string[]) =>
  patterns.some((pattern) => hostname === pattern || hostname.endsWith(`.${pattern}`));

const isHtmlLikeUrl = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  return !/\.(?:pdf|jpe?g|png|webp|gif|svg)(?:[?#].*)?$/iu.test(value);
};

const isPdfLikeUrl = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  try {
    return /\.pdf$/iu.test(new URL(value).pathname);
  } catch {
    return /\.pdf(?:[?#].*)?$/iu.test(value);
  }
};

const dedupeStringValues = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  values.forEach((value) => {
    if (typeof value !== "string") {
      return;
    }

    const normalizedValue = value.trim();
    if (!normalizedValue || seen.has(normalizedValue)) {
      return;
    }

    seen.add(normalizedValue);
    deduped.push(normalizedValue);
  });

  return deduped;
};

const resolveUrlAgainstBase = (value: string, baseUrl: string) => {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
};

const sanitizePreviewFileName = sanitizeSatellitePreviewFileName;

const getSatellitePreviewPath = (slug: string) =>
  path.join(previewImageDirectory, getSatellitePreviewStaticFileName(slug));

const normalizeJurisdictionKey = (value: string | null | undefined) =>
  value?.trim().toLowerCase().replace(/-/g, "_") ?? null;

const normalizeGeocodeCacheKey = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const buildProviderGeocodeCacheKey = (provider: string, value: string) =>
  `${provider}:${normalizeGeocodeCacheKey(value)}`;

const clampLatitude = (value: number) =>
  Math.min(85.05112878, Math.max(-85.05112878, value));

const hasStreetNumber = (value: string) =>
  streetNumberPattern.test(value);

const normalizeComparisonText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(combiningDiacriticPattern, "")
    .toLowerCase();

const splitComparisonTokens = (value: string) =>
  normalizeComparisonText(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const pageContactContextMarkers = [
  "about the buyer",
  "auftraggeber",
  "bauherr",
  "architect",
  "architekt",
  "buyer",
  "contact",
  "contact name",
  "contracting authority",
  "telephone",
  "phone",
  "email",
  "website",
  "pec",
  "legalmail",
  "fax",
  "fon",
  "help",
  "serve aiuto",
];
const pagePlanNoiseMarkers = [
  "lageplan",
  "maßstab",
  "plan-nr",
  "plan-id",
  "grundbuchbezirk",
  "gemarkung",
  "öffentlich bestellte",
  "vermessungsingenieure",
  "angefertigt nach amtlichen unterlagen",
  "urheberrechtlich geschützt",
];
const pageChromeContextMarkers = [
  "footer",
  "privacy",
  "cookie",
  "copyright",
  "terms",
  "social",
  "share this notice",
  "watch this notice",
  "print this notice",
  "login",
  "accedi",
  "contenuti in evidenza",
  "notizie",
  "news",
];
const projectContextMarkers = [
  "description",
  "descrizione",
  "planinhalt",
  "projekt",
  "subject of the contract",
  "oggetto",
  "project",
  "works",
  "lavori",
  "intervento",
  "obra",
  "rehabilit",
  "miglioramento",
  "realizzazione",
  "execution place",
  "place of performance",
  "emplazamiento",
  "sito en",
  "situado en",
  "ubicado en",
];
const emailLikePattern = /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[a-z]{2,}\b/iu;
const phoneLikePattern = /\+?\d(?:[\d()./\-\s]{5,}\d)/u;

const normalizeMarkerContext = (value: string) => splitComparisonTokens(value).join(" ");

const countDistinctMarkerMatches = (value: string, markers: string[]) => {
  const normalizedValue = normalizeMarkerContext(value);
  if (!normalizedValue) {
    return 0;
  }

  let count = 0;
  for (const marker of markers) {
    const normalizedMarker = normalizeMarkerContext(marker);
    if (normalizedMarker && normalizedValue.includes(normalizedMarker)) {
      count += 1;
    }
  }

  return count;
};

const findFirstMarkerIndex = (value: string, markers: string[]) => {
  const normalizedValue = normalizeMarkerContext(value);
  if (!normalizedValue) {
    return -1;
  }

  let firstIndex = -1;
  for (const marker of markers) {
    const normalizedMarker = normalizeMarkerContext(marker);
    if (!normalizedMarker) {
      continue;
    }

    const markerIndex = normalizedValue.indexOf(normalizedMarker);
    if (markerIndex >= 0 && (firstIndex === -1 || markerIndex < firstIndex)) {
      firstIndex = markerIndex;
    }
  }

  return firstIndex;
};

const findLastMarkerIndex = (value: string, markers: string[]) => {
  const normalizedValue = normalizeMarkerContext(value);
  if (!normalizedValue) {
    return -1;
  }

  let lastIndex = -1;
  for (const marker of markers) {
    const normalizedMarker = normalizeMarkerContext(marker);
    if (!normalizedMarker) {
      continue;
    }

    const markerIndex = normalizedValue.lastIndexOf(normalizedMarker);
    if (markerIndex > lastIndex) {
      lastIndex = markerIndex;
    }
  }

  return lastIndex;
};

const findFirstPatternIndex = (value: string, pattern: RegExp) => {
  const match = value.match(pattern);
  return match?.index ?? -1;
};

const isLikelyPageAddressNoise = (
  rawAddress: string,
  contextBefore: string,
  contextAfter: string,
) => {
  const candidateContext = `${contextBefore} ${rawAddress} ${contextAfter}`;
  const immediateContextBefore = contextBefore.slice(-120);
  const immediateContextAfter = contextAfter.slice(0, 140);
  const immediateContext = `${immediateContextBefore} ${rawAddress} ${immediateContextAfter}`;
  const candidateContactHits = countDistinctMarkerMatches(rawAddress, pageContactContextMarkers);
  const candidateChromeHits = countDistinctMarkerMatches(rawAddress, pageChromeContextMarkers);
  if (candidateContactHits > 0 || candidateChromeHits > 0) {
    return true;
  }

  const contactHits = countDistinctMarkerMatches(candidateContext, pageContactContextMarkers);
  const chromeHits = countDistinctMarkerMatches(candidateContext, pageChromeContextMarkers);
  const projectHits = countDistinctMarkerMatches(candidateContext, projectContextMarkers);
  const planNoiseHits = countDistinctMarkerMatches(candidateContext, pagePlanNoiseMarkers);
  const immediateContactHits = countDistinctMarkerMatches(immediateContext, pageContactContextMarkers);
  const immediateChromeHits = countDistinctMarkerMatches(immediateContext, pageChromeContextMarkers);
  const immediateProjectHits = countDistinctMarkerMatches(immediateContext, projectContextMarkers);
  const immediatePlanNoiseHits = countDistinctMarkerMatches(immediateContext, pagePlanNoiseMarkers);
  const previousContactMarkerIndex = Math.max(
    findLastMarkerIndex(contextBefore, pageContactContextMarkers),
    findLastMarkerIndex(contextBefore, pageChromeContextMarkers),
  );
  const previousProjectMarkerIndex = findLastMarkerIndex(contextBefore, projectContextMarkers);
  const nextContactMarkerIndex = findFirstMarkerIndex(contextAfter, pageContactContextMarkers);
  const nextProjectMarkerIndex = findFirstMarkerIndex(contextAfter, projectContextMarkers);
  const nextEmailIndex = findFirstPatternIndex(contextAfter, emailLikePattern);
  const nextPhoneIndex = findFirstPatternIndex(contextAfter, phoneLikePattern);
  const nextContactSignalIndex = [nextContactMarkerIndex, nextEmailIndex, nextPhoneIndex]
    .filter((value) => value >= 0)
    .sort((left, right) => left - right)[0] ?? -1;
  const precededByContactLead =
    previousContactMarkerIndex >= 0 &&
    (previousProjectMarkerIndex === -1 || previousContactMarkerIndex > previousProjectMarkerIndex);
  const precededByProjectLead =
    previousProjectMarkerIndex >= 0 &&
    (previousContactMarkerIndex === -1 || previousProjectMarkerIndex > previousContactMarkerIndex);
  const followedByContactBeforeProject =
    nextContactSignalIndex >= 0 &&
    (nextProjectMarkerIndex === -1 || nextContactSignalIndex < nextProjectMarkerIndex);
  const contextHasEmail = emailLikePattern.test(candidateContext);
  const contextHasPhone = phoneLikePattern.test(contextAfter);
  const immediateHasEmail =
    emailLikePattern.test(immediateContextBefore) || emailLikePattern.test(immediateContextAfter);
  const immediateHasPhone = phoneLikePattern.test(immediateContextAfter);

  if (precededByContactLead && followedByContactBeforeProject) {
    return true;
  }

  if (precededByContactLead && (immediateHasEmail || immediateHasPhone)) {
    return true;
  }

  if (followedByContactBeforeProject && (immediateContactHits >= 1 || immediateChromeHits >= 1)) {
    if (precededByProjectLead && immediateProjectHits >= 1) {
      return false;
    }

    if (immediateProjectHits === 0) {
      return true;
    }
  }

  if (immediateHasEmail && immediateContactHits >= 2 && immediateProjectHits <= 2) {
    return true;
  }

  if (immediateHasPhone && immediateContactHits >= 2 && immediateProjectHits === 0) {
    return true;
  }

  if (immediateChromeHits >= 1 && immediateProjectHits === 0) {
    return true;
  }

  if (contextHasEmail && contactHits >= 2 && projectHits <= 1) {
    if (immediateProjectHits >= 1) {
      return false;
    }
    return true;
  }

  if (contextHasPhone && contactHits >= 2 && projectHits === 0) {
    return true;
  }

  if (contactHits >= 3 && projectHits === 0) {
    return true;
  }

  if (chromeHits >= 1 && projectHits === 0) {
    return true;
  }

  if (planNoiseHits >= 2 && contactHits >= 1 && projectHits === 0) {
    return true;
  }

  if (immediatePlanNoiseHits >= 2 && immediateContactHits >= 1 && immediateProjectHits === 0) {
    return true;
  }

  return false;
};

const houseNumberCapturePattern =
  new RegExp(
    String.raw`\b(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)?(${streetNumberBodyPattern})\b`,
    "iu",
  );

const extractComparableHouseNumber = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(houseNumberCapturePattern);
  if (!match?.[1]) {
    return null;
  }

  return normalizeComparisonText(match[1]).replace(/[^\p{L}\p{N}]+/gu, "");
};

const normalizeStreetComparisonTokens = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return [];
  }

  const withoutHouseNumber = value.replace(houseNumberCapturePattern, " ");
  return splitComparisonTokens(withoutHouseNumber).filter(
    (token) =>
      !streetComparisonNoiseTokens.has(token) &&
      !new RegExp(String.raw`^${streetNumberBodyPattern}$`, "u").test(token),
  );
};

const haveStreetCoreTokenMatch = (
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
) => {
  const leftTokens = normalizeStreetComparisonTokens(leftValue);
  const rightTokens = normalizeStreetComparisonTokens(rightValue);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  if (leftTokens.join(" ") === rightTokens.join(" ")) {
    return true;
  }

  return (
    leftTokens.every((token) => rightTokens.includes(token)) ||
    rightTokens.every((token) => leftTokens.includes(token))
  );
};

const haveLocalityTokenMatch = (
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
) => {
  if (typeof leftValue !== "string" || typeof rightValue !== "string") {
    return false;
  }

  const leftTokens = splitComparisonTokens(leftValue);
  const rightTokens = splitComparisonTokens(rightValue);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  return leftTokens.every((token) => rightTokens.includes(token));
};

const getAddressCandidateComparisonKey = (candidate: AddressCandidate) =>
  normalizeComparisonText(`${candidate.kind}|${candidate.address}|${candidate.localityHint ?? ""}`);

const dedupeAddressCandidates = (candidates: AddressCandidate[]) => {
  const seen = new Set<string>();
  const deduped: AddressCandidate[] = [];

  for (const candidate of candidates) {
    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
};

const cleanAddressCandidate = (value: string) => {
  const cleaned = normalizeWhitespace(
    value
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/^(?:action)\s+/iu, "")
      .replace(/^.*?\b(?:projekt|project|projet|progetto)\s+/iu, "")
      .replace(/^.*?\b(?:przy|na\s+naslovu|sito\s+en|ubicado\s+en|situado\s+en)\s+/iu, "")
      .replace(/^(?:aan|på|pa)\s+/iu, "")
      .replace(trailingAddressFieldStopPattern, "")
      .replace(/\s+-\s+lot\s+\d+\b[\s\S]*$/iu, "")
      .replace(/,\s*\d+\s+logements?\b[\s\S]*$/iu, "")
      .replace(/\s+(?:w|v|u)\s+[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,4}\s*$/iu, "")
      .replace(/\s+pour\s+l['’][\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,6}\s*$/iu, "")
      .replace(/^[,;:\-.\s]+|[,;:\-.\s]+$/g, ""),
  );

  if (!cleaned) {
    return null;
  }

  if (
    cleaned.length > 96 ||
    rejectedAddressMarkers.test(cleaned) ||
    rejectedAddressCandidatePattern.test(cleaned)
  ) {
    return null;
  }

  return cleaned;
};

const cleanLocalityCandidate = (value: string) => {
  const stripped = value
    .replace(/\s+(?:lungo|along)\b[\s\S]*$/iu, "")
    .replace(/\s+al\s+km\b[\s\S]*$/iu, "")
    .replace(/\s+km\b[\s\S]*$/iu, "")
    .replace(/\s+sito\b[\s\S]*$/iu, "");

  return cleanAddressCandidate(stripped);
};

const cleanSiteCandidate = (value: string) =>
  cleanAddressCandidate(
    value
      .replace(/\s+(?:comprensivo|incluye|including)\b[\s\S]*$/iu, "")
      .replace(/\s*\([^)]+\)\s*$/u, ""),
  );

const cleanLocalityHint = (value: string) => {
  const cleaned = normalizeWhitespace(
    value
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(trailingAddressFieldStopPattern, "")
      .replace(/,\s*(?:district|distrito)\b[\s\S]*$/iu, "")
      .replace(/,\s*[^,]*\b(?:district|distrito)\b[\s\S]*$/iu, "")
      .replace(/\s+de\s+esta\s+localidad\b[\s\S]*$/iu, "")
      .replace(/\s+di\s+questa\s+localit[aà]\b[\s\S]*$/iu, "")
      .replace(/\s+desta\s+localidade\b[\s\S]*$/iu, "")
      .replace(/\s*\([A-Z]{2}\)\s*$/u, "")
      .replace(/^[,;:\-.\s]+|[,;:\-.\s]+$/g, ""),
  );

  if (!cleaned) {
    return null;
  }

  if (cleaned.length > 72 || rejectedLocalityMarkers.test(cleaned) || rejectedAddressMarkers.test(cleaned)) {
    return null;
  }

  if (localityTailNoisePattern.test(cleaned)) {
    return null;
  }

  return cleaned;
};

const normalizeStructuredField = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = normalizeWhitespace(value);
  return cleaned.length > 0 ? cleaned : null;
};

const leadingStreetAddressSegmentPattern = new RegExp(
  String.raw`^${addressPrefixPattern}\s+${addressBodyPattern}(?:(?:\s*,\s*|\s+)(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)?\d[\p{L}\p{N}/-]{0,7}|(?:\s*,\s*|\s+)snc)?$`,
  "iu",
);
const trailingStreetAddressSegmentPattern = new RegExp(
  String.raw`^${trailingStreetAddressPattern}(?:\s*,\s*|\s+)(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)?\d[\p{L}\p{N}/-]{0,7}$`,
  "iu",
);

const extractStreetAddressFromPlacename = (value: string | null | undefined) => {
  const normalizedValue = normalizeStructuredField(value);
  if (!normalizedValue) {
    return null;
  }

  const segments = normalizedValue.split(",").map(normalizeWhitespace).filter(Boolean);
  for (const segment of segments) {
    const normalizedSegment = segment.replace(/^\d{4,6}\s+/u, "");
    if (!normalizedSegment) {
      continue;
    }

    if (/^(?:campus)\b/iu.test(normalizedSegment)) {
      return normalizedSegment;
    }

    if (
      leadingStreetAddressSegmentPattern.test(normalizedSegment) ||
      trailingStreetAddressSegmentPattern.test(normalizedSegment)
    ) {
      return normalizedSegment;
    }
  }

  return null;
};

const extractLocalityHintFromPlacename = (value: string | null | undefined) => {
  const normalizedValue = normalizeStructuredField(value);
  if (!normalizedValue) {
    return null;
  }

  const segments = normalizedValue.split(",").map(normalizeWhitespace).filter(Boolean);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const cleanedSegment = cleanLocalityHint(segments[index].replace(/^\d{4,6}\s+/u, ""));
    if (cleanedSegment) {
      return cleanedSegment;
    }
  }

  return null;
};

const extractLocalityHintFromTail = (value: string) => {
  const localityTailPatterns = [
    new RegExp(String.raw`^\s*[,;]\s*(${localityPrefixPattern}\s+${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*[,;]\s*\d{4,6}\s+(${placeNamePattern})`, "iu"),
    new RegExp(
      String.raw`^[\s,;:-]*(?:situad[oa]s?|ubicad[oa]s?|sito(?:s)?|site[ds]?)\s+en\s+(?:la\s+|el\s+)?(${localityPrefixPattern}\s+${placeNamePattern})`,
      "iu",
    ),
    new RegExp(
      String.raw`^\s*,\s*(${placeNamePattern})\s*,\s*(?:z|with|con|w|v|u|em|en|nel|in|na|no)\b`,
      "iu",
    ),
    new RegExp(String.raw`^\s*,\s*en\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+en\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*,\s*(?:w|v|u)\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+(?:w|v|u)\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*,\s*em\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+em\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+(?:nel|in|a|na|no|te|i)\s+(${placeNamePattern})\s*\([A-Z]{2}\)`, "iu"),
    new RegExp(String.raw`^\s+(?:nel|in|a|na|no|te|i)\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*-\s*(${placeNamePattern})\s*\([A-Z]{2}\)`, "u"),
    new RegExp(String.raw`^\s*,\s*(${placeNamePattern})\s*\([A-Z]{2}\)`, "u"),
  ];

  for (const pattern of localityTailPatterns) {
    const match = value.match(pattern);
    if (!match) {
      continue;
    }

    const localityHint = cleanLocalityHint(match[1]);
    if (localityHint) {
      return localityHint;
    }
  }

  return null;
};

const extractInlineLocalityHintFromAddress = (value: string) => {
  const patterns = [
    new RegExp(String.raw`\s+(?:w|v|u)\s+(${placeNamePattern})\s*$`, "iu"),
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) {
      continue;
    }

    const localityHint = cleanLocalityHint(match[1]);
    if (localityHint) {
      return localityHint;
    }
  }

  return null;
};

const buildAddressCandidate = (
  normalizedText: string,
  match: RegExpMatchArray,
  kind: AddressCandidateKind,
  source: AddressCandidate["source"],
) => {
  const rawAddress = normalizeWhitespace(match[0]);
  const address =
    kind === "locality"
      ? cleanLocalityCandidate(rawAddress)
      : kind === "site"
        ? cleanSiteCandidate(rawAddress)
        : cleanAddressCandidate(rawAddress);
  if (!address || match.index === undefined) {
    return null;
  }

  if (source === "page") {
    const contextBefore = normalizedText.slice(Math.max(0, match.index - 160), match.index);
    const contextAfter = normalizedText.slice(
      match.index + match[0].length,
      Math.min(normalizedText.length, match.index + match[0].length + 220),
    );
    if (isLikelyPageAddressNoise(rawAddress, contextBefore, contextAfter)) {
      return null;
    }
  }

  const tail = normalizedText.slice(match.index + match[0].length);
  const tailLocalityHint = extractLocalityHintFromTail(tail);
  return {
    address,
    kind,
    localityHint: tailLocalityHint ?? extractInlineLocalityHintFromAddress(rawAddress),
    source,
  } satisfies AddressCandidate;
};

const extractAddressCandidatesFromText = (
  value: string,
  source: AddressCandidate["source"],
): AddressCandidate[] => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return [];
  }

  const seen = new Set<string>();
  const candidates: AddressCandidate[] = [];

  for (const { kind, pattern } of addressCandidatePatterns) {
    for (const match of normalized.matchAll(pattern)) {
      const candidate = buildAddressCandidate(normalized, match, kind, source);
      if (!candidate) {
        continue;
      }

      const key = getAddressCandidateComparisonKey(candidate);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
};

const normalizePdfTextForAddressExtraction = (value: string) => {
  const normalized = normalizeWhitespace(
    decodeHtmlEntities(
      value
        .replace(/\u0000/g, " ")
        .replace(/\u000c/g, " ")
        .replace(/(?<=\p{L})-\s*(?:\r?\n)+\s*(?=\p{Ll})/gu, "")
        .replace(/\r\n?/g, "\n")
        .replace(/([^\n])\n(?=\d{4,6}\s+[\p{L}])/gu, "$1; ")
        .replace(/\s*\n\s*/g, " "),
    ),
  );

  return normalized.length > pdfMaxExtractedTextLength
    ? normalized.slice(0, pdfMaxExtractedTextLength)
    : normalized;
};

const extractAddressCandidatesFromPdfText = (value: string) => {
  const normalizedText = normalizePdfTextForAddressExtraction(value);
  if (!normalizedText) {
    return [] as AddressCandidate[];
  }

  return extractAddressCandidatesFromText(normalizedText, "page");
};

const buildStructuredAddressCandidates = (record: StructuredAddressRecord) => {
  const placename = normalizeStructuredField(record.placename);
  const localityHint =
    cleanLocalityHint(record.locality ?? "") ?? extractLocalityHintFromPlacename(placename);
  const structuredStreetAddress =
    normalizeStructuredField(record.streetAddress) ?? extractStreetAddressFromPlacename(placename);

  if (structuredStreetAddress) {
    const kind = /^(?:campus)\b/iu.test(structuredStreetAddress)
      ? "site"
      : hasStreetNumber(structuredStreetAddress)
        ? "street_address"
        : "street";
    const cleanedAddress =
      kind === "site"
        ? cleanSiteCandidate(structuredStreetAddress)
        : cleanAddressCandidate(structuredStreetAddress);

    if (!cleanedAddress) {
      return [] as AddressCandidate[];
    }

    return [
      {
        address: cleanedAddress,
        kind,
        localityHint,
        source: "page",
      } satisfies AddressCandidate,
    ];
  }

  if (!placename) {
    return [] as AddressCandidate[];
  }

  return extractAddressCandidatesFromText(placename, "page").map((candidate) =>
    localityHint && !candidate.localityHint
      ? {
          ...candidate,
          localityHint,
        }
      : candidate,
  );
};

const collectJsonStructuredAddressRecords = (
  value: unknown,
  target: StructuredAddressRecord[],
) => {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonStructuredAddressRecords(entry, target));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const streetAddress = typeof record.streetAddress === "string" ? record.streetAddress : null;
  const locality =
    typeof record.addressLocality === "string"
      ? record.addressLocality
      : typeof record.locality === "string"
        ? record.locality
        : null;
  const placename =
    typeof record.name === "string"
      ? record.name
      : typeof record.alternateName === "string"
        ? record.alternateName
        : typeof record.description === "string"
          ? record.description
          : null;

  if (
    streetAddress ||
    locality ||
    typeof record.addressRegion === "string" ||
    typeof record.postalCode === "string" ||
    typeof record.addressCountry === "string"
  ) {
    target.push({
      country: typeof record.addressCountry === "string" ? record.addressCountry : null,
      locality,
      placename,
      postalCode: typeof record.postalCode === "string" ? record.postalCode : null,
      region: typeof record.addressRegion === "string" ? record.addressRegion : null,
      streetAddress,
    });
  }

  Object.values(record).forEach((entry) => collectJsonStructuredAddressRecords(entry, target));
};

const extractStructuredAddressCandidatesFromHtml = (html: string) => {
  const metaValues = new Map<string, string[]>();
  const structuredRecords: StructuredAddressRecord[] = [];

  const appendMetaValue = (key: string, value: string | null | undefined) => {
    const normalizedValue = normalizeStructuredField(value);
    if (!normalizedValue) {
      return;
    }

    const existing = metaValues.get(key) ?? [];
    if (!existing.includes(normalizedValue)) {
      existing.push(normalizedValue);
      metaValues.set(key, existing);
    }
  };

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const key = (attributes.property ?? attributes.name ?? attributes.itemprop ?? "").toLowerCase();
    if (!key) {
      continue;
    }

    appendMetaValue(key, attributes.content);
  }

  const streetAddresses = [
    ...(metaValues.get("og:street_address") ?? []),
    ...(metaValues.get("streetaddress") ?? []),
  ];
  const localities = [
    ...(metaValues.get("og:locality") ?? []),
    ...(metaValues.get("addresslocality") ?? []),
  ];
  const placenames = [...(metaValues.get("geo.placename") ?? [])];
  const postalCodes = [
    ...(metaValues.get("og:postal_code") ?? []),
    ...(metaValues.get("postalcode") ?? []),
  ];
  const regions = [
    ...(metaValues.get("og:region") ?? []),
    ...(metaValues.get("addressregion") ?? []),
  ];
  const countries = [
    ...(metaValues.get("og:country_name") ?? []),
    ...(metaValues.get("addresscountry") ?? []),
  ];

  streetAddresses.forEach((streetAddress) => {
    structuredRecords.push({
      country: countries[0] ?? null,
      locality: localities[0] ?? null,
      placename: placenames[0] ?? null,
      postalCode: postalCodes[0] ?? null,
      region: regions[0] ?? null,
      streetAddress,
    });
  });

  placenames.forEach((placename) => {
    structuredRecords.push({
      country: countries[0] ?? null,
      locality: localities[0] ?? null,
      placename,
      postalCode: postalCodes[0] ?? null,
      region: regions[0] ?? null,
      streetAddress: null,
    });
  });

  for (const match of html.matchAll(
    /<script\b[^>]*type=(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const payload = match[1]?.trim();
    if (!payload) {
      continue;
    }

    try {
      collectJsonStructuredAddressRecords(JSON.parse(payload), structuredRecords);
    } catch {
      continue;
    }
  }

  return dedupeAddressCandidates(
    structuredRecords.flatMap((record) => buildStructuredAddressCandidates(record)),
  );
};

type HtmlDocumentPayload = {
  html: string;
  ok: boolean;
  url: string;
};

const fetchHtmlDocument = async (url: string): Promise<HtmlDocumentPayload | null> => {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(htmlRequestTimeoutMs),
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html")) {
      return null;
    }

    return {
      html: await response.text(),
      ok: response.ok,
      url: response.url || url,
    };
  } catch {
    return null;
  }
};

const extractTextFromPdfBuffer = async (payload: Buffer) => {
  let tempDirectory: string | null = null;

  try {
    tempDirectory = await mkdtemp(path.join(tmpdir(), "arch-competition-ops-pdf-"));
    const tempPdfPath = path.join(tempDirectory, "source.pdf");
    await writeFile(tempPdfPath, payload);
    const { execFile } = await import("node:child_process");

    return await new Promise<string | null>((resolve) => {
      execFile(
        "pdftotext",
        [
          "-q",
          "-f",
          "1",
          "-l",
          "3",
          "-enc",
          "UTF-8",
          "-nopgbrk",
          tempPdfPath,
          "-",
        ],
        {
          encoding: "utf8",
          maxBuffer: pdfTextExtractionMaxBuffer,
          timeout: pdfTextExtractionTimeoutMs,
        },
        (error, stdout) => {
          if (error || typeof stdout !== "string" || stdout.trim().length === 0) {
            resolve(null);
            return;
          }

          resolve(stdout);
        },
      );
    });
  } catch {
    return null;
  } finally {
    if (tempDirectory) {
      await rm(tempDirectory, { force: true, recursive: true }).catch(() => undefined);
    }
  }
};

const fetchPdfText = async (url: string) => {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(pdfRequestTimeoutMs),
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const contentLength = Number(response.headers.get("content-length") ?? "");
    const resolvedUrl = response.url || url;

    if (!response.ok || (!contentType.includes("pdf") && !isPdfLikeUrl(resolvedUrl))) {
      return null;
    }

    if (Number.isFinite(contentLength) && contentLength > pdfMaxBytes) {
      return null;
    }

    const payload = Buffer.from(await response.arrayBuffer());
    if (payload.length === 0 || payload.length > pdfMaxBytes) {
      return null;
    }

    return extractTextFromPdfBuffer(payload);
  } catch {
    return null;
  }
};

const extractAddressCandidatesFromPdfUrls = async (urls: string[]) => {
  const candidates: AddressCandidate[] = [];

  for (const url of urls.slice(0, pdfMaxCandidateUrlsPerOpportunity)) {
    const pdfText = await fetchPdfText(url);
    if (!pdfText) {
      continue;
    }

    candidates.push(...extractAddressCandidatesFromPdfText(pdfText));
  }

  return dedupeAddressCandidates(candidates);
};

const fetchOpportunityPageLocationSignals = async (
  opportunity: SatellitePreviewInput,
): Promise<OpportunityPageLocationSignals> => {
  const candidateUrls = dedupeStringValues([
    opportunity.officialUrl,
    opportunity.sourceUrl,
    opportunity.documentsPortalUrl,
  ]).filter((url) => isHtmlLikeUrl(url));
  const structuredCandidates: AddressCandidate[] = [];
  const textCandidates: AddressCandidate[] = [];
  const pdfCandidateScores = new Map<string, number>();
  if (opportunity.briefPdfUrl) {
    pdfCandidateScores.set(opportunity.briefPdfUrl, 3);
  }

  for (const url of candidateUrls) {
    const document = await fetchHtmlDocument(url);
    if (!document) {
      continue;
    }

    structuredCandidates.push(...extractStructuredAddressCandidatesFromHtml(document.html));
    if (document.ok) {
      textCandidates.push(...extractAddressCandidatesFromText(stripHtmlToText(document.html), "page"));
    }
    extractPdfUrlsFromHtml(document.html, document.url).forEach((url, index) => {
      const score = Math.max(0, pdfMaxCandidateUrlsPerOpportunity - index);
      const previousScore = pdfCandidateScores.get(url) ?? Number.NEGATIVE_INFINITY;
      if (score > previousScore) {
        pdfCandidateScores.set(url, score);
      }
    });
  }

  return {
    pdfCandidates: [...pdfCandidateScores.entries()]
      .map(([url, score]) => ({ score, url }))
      .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))
      .slice(0, pdfMaxCandidateUrlsPerOpportunity),
    structuredCandidates: dedupeAddressCandidates(structuredCandidates),
    textCandidates: dedupeAddressCandidates(textCandidates),
  };
};

const loadGeocodeCache = async () => {
  if (geocodeCacheLoaded) {
    return;
  }

  geocodeCacheLoaded = true;

  try {
    const payload = JSON.parse(await readFile(geocodeCachePath, "utf8")) as {
      entries?: Record<string, GeocodeCacheEntry>;
      version?: number;
    };

    if (payload.version !== previewCacheVersion || !payload.entries) {
      return;
    }

    Object.entries(payload.entries).forEach(([key, entry]) => {
      geocodeMemoryCache.set(key, entry ?? null);
    });
  } catch {
    // Cache warm-up is best-effort only.
  }
};

const saveGeocodeCache = async () => {
  try {
    await mkdir(previewRoot, { recursive: true });
    await writeFile(
      geocodeCachePath,
      `${JSON.stringify(
        {
          entries: Object.fromEntries(geocodeMemoryCache),
          version: previewCacheVersion,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    // Cache persistence is best-effort only.
  }
};

const waitForNominatimWindow = async () => {
  const elapsed = Date.now() - geocodeLastRequestAt;
  const remaining = 1100 - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
};

const normalizeAddressForGeocoder = (value: string) =>
  normalizeWhitespace(
    value
      .replace(/^c\/\s*/iu, "Calle ")
      .replace(/^c\.(?=\s)/iu, "Calle")
      .replace(/^r\.(?=\s)/iu, "Rua")
      .replace(/^tv\.?(?=\s)/iu, "Travessa")
      .replace(/^estr\.?(?=\s)/iu, "Estrada")
      .replace(/^ul\.?(?=\s)/iu, "Ulica")
      .replace(/^al\.?(?=\s)/iu, "Aleja")
      .replace(/^bd\.?(?=\s)/iu, "Bulevard")
      .replace(/^avda\.?(?=\s)/iu, "Avenida")
      .replace(/^av\.(?=\s)/iu, "Avenida")
      .replace(/^plaza\s+/iu, "Plaza ")
      .replace(/^pza\.?\s*/iu, "Plaza ")
      .replace(/\b(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)(\d[\p{L}\p{N}/-]{0,7})\b/giu, "$1")
      .replace(/\bsnc\b/giu, "")
      .replace(/\s*,\s*/g, ", "),
  );

const stripLeadingStreetPrefixForGeocoder = (value: string) =>
  normalizeWhitespace(value.replace(streetPrefixForGeocoderStripPattern, ""));

const shouldStripLeadingStreetPrefixForGeocoder = (value: string) =>
  /^(?:ul\.?|ulica|al\.?|aleja)\s+/iu.test(value);

const expandLocalityVariantsForGeocoder = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return [];
  }

  const seen = new Set<string>();
  const variants: string[] = [];

  const pushVariant = (candidateValue: string | null | undefined) => {
    if (typeof candidateValue !== "string") {
      return;
    }

    const normalizedValue = normalizeWhitespace(candidateValue);
    if (!normalizedValue) {
      return;
    }

    const comparisonKey = normalizeComparisonText(normalizedValue);
    if (seen.has(comparisonKey)) {
      return;
    }

    seen.add(comparisonKey);
    variants.push(normalizedValue);
  };

  pushVariant(value.replace(localityWrapperStripPattern, ""));
  pushVariant(value);

  return variants;
};

const normalizeLocalityHintForGeocoder = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  return normalizeWhitespace(
    value.replace(localityWrapperStripPattern, ""),
  );
};

const expandAddressVariantsForGeocoder = (value: string) => {
  const seen = new Set<string>();
  const variants: string[] = [];

  const pushVariant = (candidateValue: string | null | undefined) => {
    if (typeof candidateValue !== "string") {
      return;
    }

    const normalizedValue = normalizeAddressForGeocoder(candidateValue);
    if (!normalizedValue) {
      return;
    }

    const comparisonKey = normalizeComparisonText(normalizedValue);
    if (seen.has(comparisonKey)) {
      return;
    }

    seen.add(comparisonKey);
    variants.push(normalizedValue);
  };

  const normalizedValue = normalizeAddressForGeocoder(value);
  pushVariant(normalizedValue);

  const compoundMatch = normalizedValue.match(compoundAddressPattern);
  if (compoundMatch) {
    pushVariant(compoundMatch[1]);
    pushVariant(compoundMatch[2]);
  }

  const referencedAddressMatch = normalizedValue.match(referencedAddressPattern);
  if (referencedAddressMatch) {
    pushVariant(referencedAddressMatch[1]);
  }

  const siteCampusMatch = normalizedValue.match(/^(Campus)\s+(.+)$/iu);
  if (siteCampusMatch) {
    pushVariant(`${siteCampusMatch[1]} ${siteCampusMatch[2].replace(/\b(?:di|de|del)\s+/iu, "")}`);

    const campusBody = siteCampusMatch[2];
    const universityCityCampusMatch = campusBody.match(
      /^Universitario\s+de\s+([\p{L}\p{N}.'’/-]+)(?:\s+de\s+la\s+Universidad\s+de\s+([\p{L}\p{N}.'’/-]+))?$/iu,
    );
    if (universityCityCampusMatch) {
      const city = universityCityCampusMatch[1];
      const university = universityCityCampusMatch[2];
      pushVariant(`Campus ${city}`);
      if (university) {
        pushVariant(`Campus ${city} ${university}`);
        pushVariant(`Campus ${city} UVa`);
      }
    }

    const iutCampusMatch = campusBody.match(/^IUT\s+([\p{L}\p{N}.'’/-]+)(?:\s+Universit[eé]\s+de\s+.+)?$/iu);
    if (iutCampusMatch) {
      pushVariant(`IUT ${iutCampusMatch[1]}`);
      pushVariant(`Institut Universitaire de Technologie de ${iutCampusMatch[1]}`);
    }
  }

  const instituteSiteMatch = normalizedValue.match(
    /^IUT\s+([\p{L}\p{N}.'’/-]+)(?:\s+Universit[eé]\s+de\s+.+)?$/iu,
  );
  if (instituteSiteMatch) {
    pushVariant(`Institut Universitaire de Technologie de ${instituteSiteMatch[1]}`);
  }

  return variants;
};

const normalizeLocalityForGeocoderSearch = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeWhitespace(
    value
      .replace(/\s*\([A-Z]{2}\)\s*/gu, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[”"]+$/g, "")
      .replace(/\b(?:w|v|u)\s+([\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,4})$/iu, "$1"),
  );

  return normalized || null;
};

const resolveGeocodeQueries = (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
) => {
  const explicitCity = pickOpportunityExplicitCity(opportunity);
  const addressVariants = expandAddressVariantsForGeocoder(candidate.address);
  const localityVariants = expandLocalityVariantsForGeocoder(candidate.localityHint);
  const localityOptions = localityVariants.length > 0 ? localityVariants : [null];
  const seenQueries = new Set<string>();
  const queries: string[] = [];

  for (const addressVariant of addressVariants) {
    for (const localityVariant of localityOptions) {
      const seenParts = new Set<string>();
      const parts: string[] = [];

      const pushPart = (value: string | null | undefined) => {
        if (typeof value !== "string") {
          return;
        }

        const normalizedValue = normalizeWhitespace(value);
        if (!normalizedValue) {
          return;
        }

        const comparisonKey = normalizeComparisonText(normalizedValue);
        if (seenParts.has(comparisonKey)) {
          return;
        }

        seenParts.add(comparisonKey);
        parts.push(normalizedValue);
      };

      pushPart(addressVariant);
      pushPart(normalizeLocalityForGeocoderSearch(normalizeLocalityHintForGeocoder(localityVariant)));
      pushPart(normalizeLocalityForGeocoderSearch(explicitCity));
      pushPart(opportunity.locationLabel);
      pushPart(opportunity.jurisdictionLabel);

      const query = normalizeWhitespace(parts.join(", "));
      const queryKey = normalizeComparisonText(query);
      if (!query || seenQueries.has(queryKey)) {
        continue;
      }

      seenQueries.add(queryKey);
      queries.push(query);
    }
  }

  return queries;
};

const resolveFallbackGeocodeQueries = (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
) => {
  const strippedAddress = stripLeadingStreetPrefixForGeocoder(candidate.address);
  const explicitCity = normalizeLocalityForGeocoderSearch(pickOpportunityExplicitCity(opportunity));
  const normalizedLocalityHint = normalizeLocalityForGeocoderSearch(
    normalizeLocalityHintForGeocoder(candidate.localityHint),
  );
  const fallbackCandidate =
    strippedAddress !== candidate.address && candidate.kind === "street_address"
      ? {
          ...candidate,
          address: strippedAddress,
          localityHint:
            explicitCity &&
            normalizedLocalityHint &&
            normalizeComparisonText(explicitCity) !== normalizeComparisonText(normalizedLocalityHint)
              ? null
              : candidate.localityHint,
          kind: "street" as const,
        }
      : strippedAddress !== candidate.address && candidate.kind === "street"
        ? {
            ...candidate,
            address: strippedAddress,
            localityHint:
              explicitCity &&
              normalizedLocalityHint &&
              normalizeComparisonText(explicitCity) !== normalizeComparisonText(normalizedLocalityHint)
                ? null
                : candidate.localityHint,
          }
        : candidate;

  const fallbackQueries = resolveGeocodeQueries(opportunity, fallbackCandidate);
  return fallbackQueries.filter((query) => query.length > 0);
};

const resolveCountryComparisonTokens = (jurisdictionKey: string | null | undefined) => {
  const normalizedKey = normalizeJurisdictionKey(jurisdictionKey);
  if (!normalizedKey) {
    return [];
  }

  return (countryComparisonVariantsByJurisdiction[normalizedKey] ?? []).flatMap((value) =>
    splitComparisonTokens(value),
  );
};

const normalizePhotonLocalityValue = (feature: PhotonFeature) =>
  normalizeWhitespace(
    [
      feature.properties?.city,
      feature.properties?.district,
      feature.properties?.county,
      feature.properties?.state,
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" "),
  );

const doesPhotonFeatureMatchCandidate = (
  feature: PhotonFeature,
  candidate: AddressCandidate,
  opportunity: SatellitePreviewInput,
) => {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return false;
  }

  const featureStreet = feature.properties?.street ?? feature.properties?.name ?? null;
  const localityHint =
    normalizeLocalityForGeocoderSearch(normalizeLocalityHintForGeocoder(candidate.localityHint)) ??
    normalizeLocalityForGeocoderSearch(pickOpportunityExplicitCity(opportunity)) ??
    normalizeLocalityForGeocoderSearch(opportunity.locationLabel);
  const featureLocality = normalizePhotonLocalityValue(feature);
  const candidateHouseNumber = extractComparableHouseNumber(candidate.address);
  const featureHouseNumber = extractComparableHouseNumber(feature.properties?.housenumber ?? null);
  const countryTokens = resolveCountryComparisonTokens(opportunity.jurisdictionKey);
  const featureCountryTokens = splitComparisonTokens(feature.properties?.country ?? "");

  if (candidateHouseNumber && featureHouseNumber && candidateHouseNumber !== featureHouseNumber) {
    return false;
  }

  if (countryTokens.length > 0 && !countryTokens.some((token) => featureCountryTokens.includes(token))) {
    return false;
  }

  if (!haveStreetCoreTokenMatch(candidate.address, featureStreet)) {
    return false;
  }

  if (localityHint && !haveLocalityTokenMatch(localityHint, featureLocality)) {
    return false;
  }

  return true;
};

const geocodeViaPhoton = async (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
): Promise<GeocodeResult | null> => {
  const query = normalizeWhitespace(
    [
      candidate.address,
      normalizeLocalityForGeocoderSearch(normalizeLocalityHintForGeocoder(candidate.localityHint)),
      normalizeLocalityForGeocoderSearch(pickOpportunityExplicitCity(opportunity)),
      normalizeLocalityForGeocoderSearch(opportunity.locationLabel),
      opportunity.jurisdictionLabel,
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" "),
  );

  if (!query) {
    return null;
  }

  const cacheKey = buildProviderGeocodeCacheKey("photon", query);
  if (geocodeMemoryCache.has(cacheKey)) {
    const cached = geocodeMemoryCache.get(cacheKey);
    return cached ? { lat: cached.lat, lng: cached.lng } : null;
  }

  try {
    const params = new URLSearchParams({
      limit: "5",
      q: query,
    });
    const response = await fetch(`${photonSearchUrl}?${params.toString()}`, {
      headers: {
        accept: "application/json",
        "user-agent": "arch-competition-ops/0.1 satellite-preview",
      },
      signal: AbortSignal.timeout(geocodeRequestTimeoutMs),
    });

    if (!response.ok) {
      geocodeMemoryCache.set(cacheKey, null);
      await saveGeocodeCache();
      return null;
    }

    const payload = (await response.json()) as PhotonSearchResult | undefined;
    const firstMatchingFeature = payload?.features?.find((feature) =>
      doesPhotonFeatureMatchCandidate(feature, candidate, opportunity),
    );
    const coordinates = firstMatchingFeature?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) {
      geocodeMemoryCache.set(cacheKey, null);
      await saveGeocodeCache();
      return null;
    }

    const [lng, lat] = coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      geocodeMemoryCache.set(cacheKey, null);
      await saveGeocodeCache();
      return null;
    }

    const result = { lat, lng };
    geocodeMemoryCache.set(cacheKey, result);
    await saveGeocodeCache();
    return result;
  } catch {
    return null;
  }
};

const calculateBoundingBoxDiagonalKm = (boundingBox: string[] | undefined) => {
  if (!Array.isArray(boundingBox) || boundingBox.length !== 4) {
    return null;
  }

  const [south, north, west, east] = boundingBox.map((value) => Number(value));
  if (![south, north, west, east].every((value) => Number.isFinite(value))) {
    return null;
  }

  const latitudeSpanKm = Math.abs(north - south) * 111.32;
  const midpointLatitude = ((south + north) / 2) * (Math.PI / 180);
  const longitudeSpanKm = Math.abs(east - west) * 111.32 * Math.cos(midpointLatitude);
  return Math.sqrt(latitudeSpanKm ** 2 + longitudeSpanKm ** 2);
};

const isAcceptableGeocodeResult = (
  result: NominatimSearchResult,
  candidate: AddressCandidate,
) => {
  const addresstype = result.addresstype?.toLowerCase() ?? "";
  const category = result.category?.toLowerCase() ?? "";
  const type = result.type?.toLowerCase() ?? "";
  const diagonalKm = calculateBoundingBoxDiagonalKm(result.boundingbox);
  const hasHouseNumber = Boolean(result.address?.house_number);

  if (rejectedGeocodeAddressTypes.has(addresstype) || rejectedGeocodeAddressTypes.has(type)) {
    return false;
  }

  if (category && !acceptedGeocodeCategories.has(category)) {
    if (candidate.kind !== "site" || !acceptedSiteGeocodeCategories.has(category)) {
      return false;
    }
  }

  if (
    addresstype.length > 0 &&
    !(addresstype === "place" && hasHouseNumber) &&
    !acceptedExactGeocodeAddressTypes.has(addresstype) &&
    candidate.kind !== "locality"
  ) {
    return false;
  }

  if (diagonalKm === null) {
    return true;
  }

  if (candidate.kind === "locality") {
    return diagonalKm <= 8;
  }

  if (candidate.kind === "site") {
    return diagonalKm <= 3.5;
  }

  if (candidate.kind === "street_address") {
    return diagonalKm <= 4;
  }

  return diagonalKm <= 6;
};

const geocodePreciseAddress = async (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
): Promise<GeocodeResult | null> => {
  await loadGeocodeCache();

  const queries = resolveGeocodeQueries(opportunity, candidate);
  const fallbackQueries =
    candidate.kind === "street_address" || candidate.kind === "street"
      ? resolveFallbackGeocodeQueries(opportunity, candidate)
      : [];
  const countryCode = countryCodeByJurisdiction[normalizeJurisdictionKey(opportunity.jurisdictionKey) ?? ""];

  for (const query of [...queries, ...fallbackQueries]) {
    const cacheKey = buildProviderGeocodeCacheKey("nominatim", query);
    if (geocodeMemoryCache.has(cacheKey)) {
      const cached = geocodeMemoryCache.get(cacheKey);
      if (cached) {
        return { lat: cached.lat, lng: cached.lng };
      }

      continue;
    }

    const params = new URLSearchParams({
      addressdetails: "1",
      format: "jsonv2",
      limit: "1",
      q: query,
    });
    if (countryCode) {
      params.set("countrycodes", countryCode);
    }

    await waitForNominatimWindow();

    try {
      const response = await fetch(`${nominatimSearchUrl}?${params.toString()}`, {
        headers: {
          accept: "application/json",
          "user-agent": "arch-competition-ops/0.1 satellite-preview",
        },
        signal: AbortSignal.timeout(geocodeRequestTimeoutMs),
      });

      geocodeLastRequestAt = Date.now();

      if (!response.ok) {
        geocodeMemoryCache.set(cacheKey, null);
        await saveGeocodeCache();
        continue;
      }

      const payload = (await response.json()) as NominatimSearchResult[] | undefined;
      const first = Array.isArray(payload) ? payload[0] : undefined;
      if (!first || !isAcceptableGeocodeResult(first, candidate)) {
        geocodeMemoryCache.set(cacheKey, null);
        await saveGeocodeCache();
        continue;
      }

      const lat = Number(first?.lat);
      const lng = Number(first?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        geocodeMemoryCache.set(cacheKey, null);
        await saveGeocodeCache();
        continue;
      }

      const result = {
        lat,
        lng,
      };
      geocodeMemoryCache.set(cacheKey, result);
      await saveGeocodeCache();
      return result;
    } catch {
      continue;
    }
  }

  if (candidate.kind === "street_address" || candidate.kind === "street") {
    return geocodeViaPhoton(opportunity, candidate);
  }

  return null;
};

const projectToWorldPixels = (latitude: number, longitude: number, zoom: number) => {
  const scale = satelliteTileSize * 2 ** zoom;
  const lat = clampLatitude(latitude) * (Math.PI / 180);
  const x = ((longitude + 180) / 360) * scale;
  const y =
    (0.5 - Math.log((1 + Math.sin(lat)) / (1 - Math.sin(lat))) / (4 * Math.PI)) * scale;

  return { x, y };
};

const buildSatelliteTileUrl = (zoom: number, tileY: number, tileX: number) =>
  satelliteTileUrlTemplate
    .replace("{z}", String(zoom))
    .replace("{y}", String(tileY))
    .replace("{x}", String(tileX));

const fetchSatelliteTile = async (zoom: number, tileY: number, tileX: number) => {
  try {
    const response = await fetch(buildSatelliteTileUrl(zoom, tileY, tileX), {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(tileRequestTimeoutMs),
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.startsWith("image/")) {
      return null;
    }

    const payload = Buffer.from(await response.arrayBuffer());
    return payload.length > 0 ? payload : null;
  } catch {
    return null;
  }
};

const renderSatellitePreview = async (
  latitude: number,
  longitude: number,
  candidate: AddressCandidate,
) => {
  const zoom =
    candidate.kind === "locality"
      ? satelliteZoomWithLocality
      : candidate.kind === "site"
        ? 16
      : hasStreetNumber(candidate.address)
        ? satelliteZoomWithStreetNumber
        : satelliteZoomWithoutStreetNumber;
  const center = projectToWorldPixels(latitude, longitude, zoom);
  const halfSize = satelliteImageSize / 2;
  const minX = center.x - halfSize;
  const minY = center.y - halfSize;
  const maxX = center.x + halfSize;
  const maxY = center.y + halfSize;
  const minTileX = Math.floor(minX / satelliteTileSize);
  const maxTileX = Math.floor(maxX / satelliteTileSize);
  const minTileY = Math.floor(minY / satelliteTileSize);
  const maxTileY = Math.floor(maxY / satelliteTileSize);
  const maxTilesPerAxis = 2 ** zoom;
  const tilePositions: Array<{ tileX: number; tileY: number; wrappedTileX: number }> = [];

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY < 0 || tileY >= maxTilesPerAxis) {
        continue;
      }

      tilePositions.push({
        tileX,
        tileY,
        wrappedTileX: ((tileX % maxTilesPerAxis) + maxTilesPerAxis) % maxTilesPerAxis,
      });
    }
  }

  const compositeCandidates = await Promise.all(
    tilePositions.map(async ({ tileX, tileY, wrappedTileX }) => {
      const tileBuffer = await fetchSatelliteTile(zoom, tileY, wrappedTileX);
      if (!tileBuffer) {
        return null;
      }

      return {
        input: tileBuffer,
        left: Math.round(tileX * satelliteTileSize - minX),
        top: Math.round(tileY * satelliteTileSize - minY),
      };
    }),
  );
  const composites = compositeCandidates.flatMap((candidate) => (candidate ? [candidate] : []));

  if (composites.length < 6) {
    return null;
  }

  return sharp({
    create: {
      background: "#dad5ca",
      channels: 3,
      height: satelliteImageSize,
      width: satelliteImageSize,
    },
  })
    .composite(composites)
    .modulate({ brightness: 1.02, saturation: 1.04 })
    .sharpen()
    .jpeg({ mozjpeg: true, quality: 84 })
    .toBuffer();
};

export const isStadtZurichOpportunitySource = (opportunity: SatellitePreviewInput) => {
  const candidateUrls = [
    opportunity.officialUrl,
    opportunity.sourceUrl,
    opportunity.documentsPortalUrl,
    opportunity.briefPdfUrl,
  ];

  return candidateUrls.some((url) => hostMatches(getHostname(url), stadtZurichHosts));
};

export const resolveOpportunitySatellitePreview = async (
  opportunity: SatellitePreviewInput,
) => {
  if (satellitePreviewMemoryCache.has(opportunity.slug)) {
    return satellitePreviewMemoryCache.get(opportunity.slug) ?? null;
  }

  const previewPath = getSatellitePreviewPath(opportunity.slug);
  if (existsSync(previewPath)) {
    try {
      const cachedPreview = await readFile(previewPath);
      satellitePreviewMemoryCache.set(opportunity.slug, cachedPreview);
      return cachedPreview;
    } catch {
      // Fall through and attempt regeneration.
    }
  }

  const persistPreviewBuffer = async (previewBuffer: Buffer | null) => {
    satellitePreviewMemoryCache.set(opportunity.slug, previewBuffer);
    if (!previewBuffer) {
      return null;
    }

    try {
      await mkdir(previewImageDirectory, { recursive: true });
      await writeFile(previewPath, previewBuffer);
    } catch {
      // Disk cache is best-effort only.
    }

    return previewBuffer;
  };

  const tryRenderFromCandidates = async (candidates: AddressCandidate[]) => {
    for (const candidate of candidates) {
      const geocode = await geocodePreciseAddress(opportunity, candidate);
      if (!geocode) {
        continue;
      }

      const previewBuffer = await renderSatellitePreview(geocode.lat, geocode.lng, candidate);
      if (previewBuffer) {
        return previewBuffer;
      }
    }

    return null;
  };

  const titleCandidates = extractAddressCandidatesFromText(opportunity.title, "title");
  const titlePreview = await tryRenderFromCandidates(titleCandidates);
  if (titlePreview) {
    return persistPreviewBuffer(titlePreview);
  }

  const pageLocationSignals = await fetchOpportunityPageLocationSignals(opportunity);
  const pageSignalCandidates = dedupeAddressCandidates([
    ...pageLocationSignals.structuredCandidates,
    ...pageLocationSignals.textCandidates,
  ]);
  const seenKeys = new Set(titleCandidates.map((candidate) => getAddressCandidateComparisonKey(candidate)));
  const pageCandidates = pageSignalCandidates.filter(
    (candidate) => !seenKeys.has(getAddressCandidateComparisonKey(candidate)),
  );
  pageCandidates.forEach((candidate) => {
    seenKeys.add(getAddressCandidateComparisonKey(candidate));
  });

  const previewBuffer = await tryRenderFromCandidates(pageCandidates);
  if (previewBuffer) {
    return persistPreviewBuffer(previewBuffer);
  }

  const pdfSignalCandidates = await extractAddressCandidatesFromPdfUrls(
    pageLocationSignals.pdfCandidates.map((candidate) => candidate.url),
  );
  const pdfCandidates = pdfSignalCandidates.filter(
    (candidate) => !seenKeys.has(getAddressCandidateComparisonKey(candidate)),
  );
  const pdfPreview = await tryRenderFromCandidates(pdfCandidates);
  if (!pdfPreview) {
    return persistPreviewBuffer(null);
  }

  return persistPreviewBuffer(pdfPreview);
};

export const satellitePreviewContentType = imageContentType;
export const satellitePreviewTestUtils = {
  expandAddressVariantsForGeocoder,
  expandLocalityVariantsForGeocoder,
  extractAddressCandidatesFromText,
  extractAddressCandidatesFromPdfText,
  extractPdfUrlsFromHtml,
  extractStructuredAddressCandidatesFromHtml,
  resolveGeocodeQueries,
  stripHtmlToText,
};
