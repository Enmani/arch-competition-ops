import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import type { StoredOpportunityFeedItem } from "@arch-competition/storage/cloudflare";

import {
  pickOpportunityDisplayLocality,
  pickOpportunityExplicitCity,
  sanitizeOpportunityLocationLabel,
} from "./opportunity-location";
import {
  getSatellitePreviewStaticFileName,
  sanitizeSatellitePreviewFileName,
} from "./opportunity-satellite-preview-cache";
import { satellitePreviewRevision } from "./opportunity-preview-revision";
import { isInvalidSatellitePreviewBuffer } from "./opportunity-satellite-preview-quality";

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
  precision?: SatellitePreviewPrecision;
} | null;

type GeocodeResult = {
  lat: number;
  lng: number;
  precision: SatellitePreviewPrecision;
};

type SatellitePreviewPrecision = "address" | "street" | "site" | "square" | "locality" | "city";

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

type BaiduGeocodeResult = {
  analys_level?: string;
  confidence?: number | string;
  comprehension?: number | string;
  level?: string;
  location?: {
    lat?: number | string;
    lng?: number | string;
  };
  precise?: number | string;
};

type BaiduGeocodeResponse = {
  message?: string;
  result?: BaiduGeocodeResult | null;
  status?: number | string;
};

type AmapGeocodeResult = {
  city?: string | string[];
  citycode?: string;
  district?: string;
  formatted_address?: string;
  level?: string;
  location?: string;
};

type AmapGeocodeResponse = {
  count?: number | string;
  geocodes?: AmapGeocodeResult[];
  info?: string;
  status?: number | string;
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const resolveRuntimeRepoRoot = () => {
  const cwd = process.cwd();
  const candidates = [
    cwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "../.."),
    path.resolve(cwd, "../../.."),
    path.resolve(currentDirectory, "../../.."),
  ];

  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, "AGENTS.md")) &&
      existsSync(path.join(candidate, "data")) &&
      existsSync(path.join(candidate, "config"))
    ) {
      return candidate;
    }
  }

  return path.resolve(currentDirectory, "../../..");
};
const runtimeRepoRoot = resolveRuntimeRepoRoot();

const parseEnvAssignment = (line: string) => {
  const trimmedLine = line.trim();
  if (!trimmedLine || trimmedLine.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmedLine.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = trimmedLine.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  let value = trimmedLine.slice(separatorIndex + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
};

const loadSatellitePreviewLocalEnv = () => {
  const candidatePaths = [
    path.join(runtimeRepoRoot, ".env"),
    path.join(runtimeRepoRoot, "apps", "web", ".env.local"),
  ];

  candidatePaths.forEach((candidatePath) => {
    if (!existsSync(candidatePath)) {
      return;
    }

    try {
      const payload = readFileSync(candidatePath, "utf8");
      payload.split(/\r?\n/).forEach((line) => {
        const assignment = parseEnvAssignment(line);
        if (!assignment || process.env[assignment.key] !== undefined) {
          return;
        }

        process.env[assignment.key] = assignment.value;
      });
    } catch {
      // Local env loading is best-effort only.
    }
  });
};

loadSatellitePreviewLocalEnv();
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
const satellitePreviewDebugEnabled = process.env.ARCH_SATELLITE_DEBUG === "1";
const nominatimSearchUrl =
  process.env.ARCH_SATELLITE_GEOCODER_URL?.trim() ||
  "https://nominatim.openstreetmap.org/search";
const photonSearchUrl =
  process.env.ARCH_SATELLITE_PHOTON_URL?.trim() ||
  "https://photon.komoot.io/api";
const baiduGeocoderUrl =
  process.env.ARCH_SATELLITE_BAIDU_GEOCODER_URL?.trim() ||
  "https://api.map.baidu.com/geocoding/v3/";
const baiduGeocoderAk =
  process.env.ARCH_SATELLITE_BAIDU_AK?.trim() ||
  process.env.BAIDU_MAPS_AK?.trim() ||
  "";
const baiduGeocoderSk =
  process.env.ARCH_SATELLITE_BAIDU_SK?.trim() ||
  process.env.BAIDU_MAPS_SK?.trim() ||
  "";
const amapGeocoderUrl =
  process.env.ARCH_SATELLITE_AMAP_GEOCODER_URL?.trim() ||
  "https://restapi.amap.com/v3/geocode/geo";
const amapGeocoderKey =
  process.env.ARCH_SATELLITE_AMAP_KEY?.trim() ||
  process.env.AMAP_MAPS_KEY?.trim() ||
  "";
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
const addressPrefixPattern = String.raw`(?:c\/|c\.|via|viale|piazza|piazzale|corso|largo|vicolo|lungomare|strada|street|road|drive|lane|way|boulevard|avenue|avenues|avenida|avda\.?|av\.|rue|route|chemin|all[eé]e|allee|impasse|quai|parvis|esplanade|gasse|platz|strasse|straße|calle|camino|carretera|ruta|plaza|paseo|ronda|rua|travessa|estrada|pra[çc]a|cal[çc]ada|rotunda|marginal|laan|plein|gracht|kade|singel|dreef|steiger|ul\.?|ulica|ulice|aleja|al\.|bd\.?|bulevard(?:ul)?|bulvar|bulevar|str\.?|calea|sos\.?|șos\.?|ул\.?)`;
const addressBodyPattern = String.raw`[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,7}`;
const localityPrefixPattern =
  String.raw`(?:località|localita|barrio|bairro|quartiere|frazione|hamlet|village|neighbourhood|neighborhood|suburb|district|distrito|urbanizaci[oó]n|freguesia|wijk|stadsdeel|bydel|campus)`;
const placeNamePattern = String.raw`[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,5}`;
const localityWrapperStripPattern =
  /^(?:barrio|bairro|quartiere|frazione|hamlet|village|neighbourhood|neighborhood|suburb|district|distrito|urbanizaci[oó]n|freguesia|wijk|stadsdeel|bydel|quartier|lotissement|urbanizzazione|resid[eé]nce|residenza)\s+/iu;
const sitePrefixPattern = String.raw`(?:campus)`;
const siteBodyPattern = String.raw`[\p{L}\p{N}.'’/-]+(?:\s+(?:di|de|del|de la|de los|of)\s+)?(?:[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,5})`;
const dashDelimitedLocalityTokenPattern = String.raw`[\p{L}\p{N}.'’/]+(?:-[\p{L}\p{N}.'’/]+)*`;
const titleSitePrefixPattern =
  String.raw`(?:campus|quartier|quartiers|lotissement|urbanizaci[oó]n|urbanizzazione|resid[eé]nce|residenza|parque(?:\s+empresarial)?|parco|groupe\s+scolaire|[eé]cole|coll[eè]ge|lyc[eé]e|gymnase|mus[eé]e|palais|complexe|centre\s+d['’]intervention|zac|zap|zone\s+d['’](?:am[eé]nagement|activit[eé]s?)|site(?:\s+pilote)?|[iî]lot|ilot|secteur|sous-secteur|lieu-dit)`;
const frenchDashDelimitedSiteLeadPattern = new RegExp(
  String.raw`\b(${dashDelimitedLocalityTokenPattern}(?:\s+${dashDelimitedLocalityTokenPattern}){0,4})\s*[-–—]\s+((?:${addressPrefixPattern}|${titleSitePrefixPattern})\s+[\p{L}\p{N}"«»'’/-]+(?:\s+[\p{L}\p{N}"«»'’/-]+){0,8})`,
  "giu",
);
const frenchQuotedSiteLeadPattern = new RegExp(
  String.raw`\b(${dashDelimitedLocalityTokenPattern}(?:\s+${dashDelimitedLocalityTokenPattern}){0,4})\s*[«"]\s*((?:${titleSitePrefixPattern})\s+[\p{L}\p{N}"'’/-]+(?:\s+[\p{L}\p{N}"'’/-]+){0,8})\s*[»"]`,
  "giu",
);
const chineseInstitutionCampusPattern =
  /((?:[\p{Script=Han}]{2,20}(?:大学|学院|学校|中学|医院))[\p{Script=Han}\p{L}\p{N}-]{0,20}?(?:校区|院区))/gu;
const chineseRoadInsideSitePattern =
  /([\p{Script=Han}]{1,8}(?:路|街|道))(?=(?:校区|院区|片区|小区))/u;
const chineseShortSiteAnchorPattern =
  /((?:[\p{Script=Han}\p{L}\p{N}-]{2,24}(?:片区|片小区|街区))|(?:[\p{Script=Han}\p{L}\p{N}-]{2,24}小区))(?:老旧(?:小区|街区)|改造工程|改造项目|修复改造|建设项目)?/u;
const chineseStreetAsLocalityPattern =
  /(?:^|\d{4}年|[^\p{Script=Han}])((?:[\p{Script=Han}]{1,12}(?:市|区|县)){0,3}[\p{Script=Han}]{1,12}街道)(?=[\p{Script=Han}\p{L}\p{N}-]{0,24}(?:老旧小区|改造工程|改造项目|建设项目))/u;
const chineseAdministrativeSitePattern =
  /(?:^|\d{4}年|[^\p{Script=Han}])((?:[\p{Script=Han}]{1,12}(?:市|区|县)){0,2}[\p{Script=Han}]{1,12}(?:街道|镇|乡)[\p{Script=Han}\p{L}\p{N}-]{0,16}(?:老旧小区|小区|片区|街区))/u;
const chineseAdministrativeUnitPattern = String.raw`(?:[\p{Script=Han}]{1,12}(?:省|市|县|镇|乡|街道|新区|开发区|自治州|自治县)|[\p{Script=Han}]{1,12}(?<!街)(?<!院)(?<!校)(?<!园)(?<!片)(?<!社)(?<!小)区)`;
const chineseCompoundPlacePattern =
  String.raw`[\p{Script=Han}\p{L}\p{N}-]{1,40}(?:校区|院区|园区|片区|街区|地块|小区|社区|村\d+号|村|广场|公园|基地)`;
const chineseRoadPattern =
  String.raw`[\p{Script=Han}\p{L}\p{N}-]{1,30}(?:路|街(?!区)|道|巷|胡同|正街|大道)`;
const chineseDirectionalRoadPattern =
  String.raw`(${chineseRoadPattern})(?=\s*(?:以东|以西|以南|以北))`;
const chinesePreciseSiteFieldPattern = new RegExp(
  String.raw`(?:建设地点|工程地点|项目地点|实施地点)[：:]\s*((?:(?:${chineseAdministrativeUnitPattern}){0,4})[\p{Script=Han}\p{L}\p{N}-]{1,48}(?:校区|院区|园区|片区|街区|地块|小区|社区|村\d+号|村|广场|公园|基地|院内|院区内|校区内))`,
  "gu",
);
const chinesePreciseStreetFieldPattern = new RegExp(
  String.raw`(?:建设地点|工程地点|项目地点|实施地点)[：:]\s*((?:(?:(?:${chineseAdministrativeUnitPattern}){0,4})\s*)?${chineseRoadPattern}(?:\s*\d+\s*号)?)`,
  "gu",
);
const trailingStreetTypePattern =
  String.raw`(?:straat|laan|plein|gracht|kade|singel|dreef|gade|gata|gatan|gate|torv|torget|plass|plassen|vei|veien|veg|vegen|v[aä]g|v[aä]gen|weg|ring|damm|ufer|allee|pfad|stieg|steig|tie|katu|kuja|polku|cesta|strasse|straße|ulica|n[aá]m[ěe]st[ií]|trg|utca)`;
const compoundTrailingStreetWordPattern =
  String.raw`[\p{L}\p{N}.'’/-]+${trailingStreetTypePattern}`;
const multiWordCompoundTrailingStreetPattern =
  String.raw`[\p{L}\p{N}.'’/-]+\s+[\p{L}\p{N}.'’/-]+${trailingStreetTypePattern}`;
const spacedTrailingStreetPattern =
  String.raw`[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,4}\s+${trailingStreetTypePattern}`;
const trailingStreetAddressPattern = String.raw`(?:${multiWordCompoundTrailingStreetPattern}|${spacedTrailingStreetPattern}|${compoundTrailingStreetWordPattern})`;
const titleStreetTailBoundaryPattern = String.raw`(?=(?:\s*[-–—]\s+)|(?:\s*,\s*(?:${localityPrefixPattern}\s+${placeNamePattern}|${placeNamePattern}(?:\s*\((?:[A-Z]{2}|\d{2,5})\))?))|(?:\s+(?:à|au|aux|sur|sous|l[eè]s|en|em|w|v|u|im|am|bei|auf|nel|nella|in|na|no|te|i)\s+${placeNamePattern}(?:\s*\((?:[A-Z]{2}|\d{2,5})\))?)|(?:\s*\([A-Z0-9-]{2,}\))|[.;,)]|$)`;
const titleSiteTailBoundaryPattern = String.raw`(?=(?:\s*[-–—]\s+)|(?:\s*,\s*(?:${placeNamePattern}(?:\s*\((?:[A-Z]{2}|\d{2,5})\))?))|(?:\s+(?:à|au|aux|sur|sous|l[eè]s|en|em|w|v|u|im|am|bei|auf|nel|nella|in|na|no|te|i)\s+${placeNamePattern}(?:\s*\((?:[A-Z]{2}|\d{2,5})\))?)|[.;,)]|$)`;
const numberLeadingStreetAddressPattern = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:\d+(?:\s+(?:bis|ter|quater))?|${streetNumberBodyPattern})\s+${addressPrefixPattern}\s+${addressBodyPattern}${titleStreetTailBoundaryPattern}`,
  "giu",
);
const titleAddressCandidatePatterns: Array<{ kind: AddressCandidateKind; pattern: RegExp }> = [
  {
    kind: "street_address",
    pattern: numberLeadingStreetAddressPattern,
  },
  {
    kind: "street",
    pattern: new RegExp(
      String.raw`\b${addressPrefixPattern}\s+${addressBodyPattern}${titleStreetTailBoundaryPattern}`,
      "giu",
    ),
  },
  {
    kind: "street",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])${trailingStreetAddressPattern}${titleStreetTailBoundaryPattern}`,
      "giu",
    ),
  },
  {
    kind: "site",
    pattern: new RegExp(
      String.raw`\b${titleSitePrefixPattern}\s+${placeNamePattern}${titleSiteTailBoundaryPattern}`,
      "giu",
    ),
  },
];
const compoundAddressPattern = new RegExp(
  String.raw`^(${addressPrefixPattern}\s+${addressBodyPattern})\s+(?:con|with)\s+(${addressPrefixPattern}\s+${addressBodyPattern})$`,
  "iu",
);
const referencedAddressPattern = new RegExp(
  String.raw`\b(?:a|to|towards|verso)\s+(${addressPrefixPattern}\s+${addressBodyPattern})$`,
  "iu",
);
const streetPrefixForGeocoderStripPattern = new RegExp(
  String.raw`^(?:c\/|c\.|via|viale|piazza|piazzale|corso|largo|vicolo|lungomare|strada|street|road|drive|lane|way|boulevard|avenue|avenida|avda\.?|av\.|rue|route|allee|gasse|platz|strasse|straße|calle|camino|carretera|ruta|plaza|paseo|ronda|rua|travessa|estrada|pra[çc]a|cal[çc]ada|rotunda|marginal|laan|plein|gracht|kade|singel|dreef|steiger|ul\.?|ulica|ulice|aleja|al\.|bd\.?|bulevard(?:ul)?|bulvar|bulevar|str\.?|calea|sos\.?|șos\.?|ул\.?)\s+`,
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
  /^(?:al|c\.?\s*\d+|art\.?\s*\d+|co\.?\s*\d+|comma\s+\d+|lett\.?\s*[a-z]|strasse\s+\d[\p{L}\p{N}/-]*|straße\s+\d[\p{L}\p{N}/-]*)$/iu;
const rejectedProceduralAddressPattern =
  /\b(?:coordinatore\s+per\s+la\s+sicurezza|patrimonio\s+del\s+comune|direzione\s+lavori|servizi?\s+tecnici|servizi?\s+di\s+ingegneria|affidamento|progettazione|redazione|fachplanung|projektsteuerung|obras|contrataci[oó]n|concesi[oó]n|servicios?\s+de|lavori\s+di)\b/iu;
const rejectedLocalityMarkers =
  /\b(?:esta localidad|questa località|this locality|questo comune|distrito suroeste de esta localidad)\b/iu;
const rejectedBroadChineseLocalityPattern = /(?:省|自治区|特别行政区)$/u;
const multiLocalityConnectorPattern =
  /\b(?:and|et|y|e)\b|(?:ayuntamientos\s+de)|(?:captages?\s+de)|(?:,\s*[\p{L}\p{Script=Han}]{2,}){2,}/iu;
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
const acceptedBroadGeocodeAddressTypes = new Set([
  "city",
  "hamlet",
  "locality",
  "municipality",
  "neighbourhood",
  "neighborhood",
  "place",
  "quarter",
  "road",
  "square",
  "suburb",
  "town",
  "village",
]);
const acceptedGeocodeCategories = new Set(["building", "highway", "landuse", "place"]);
const acceptedSiteGeocodeCategories = new Set(["amenity", "building", "landuse"]);
const acceptedLocalityGeocodeCategories = new Set(["boundary", "place"]);
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
const satellitePreviewDebugTraceBySlug = new Map<string, string[]>();
let geocodeCacheLoaded = false;
let geocodeLastRequestAt = 0;

const debugSatellitePreview = (...values: unknown[]) => {
  const slug = typeof values[0] === "string" ? values[0] : null;
  if (slug) {
    const trace = satellitePreviewDebugTraceBySlug.get(slug) ?? [];
    trace.push(
      values
        .map((value) =>
          typeof value === "string" ? value : JSON.stringify(value),
        )
        .join(" "),
    );
    satellitePreviewDebugTraceBySlug.set(slug, trace.slice(-24));
  }

  if (!satellitePreviewDebugEnabled) {
    return;
  }

  console.log("[satellite-preview]", ...values);
};

export const getSatellitePreviewDebugTrace = (slug: string) =>
  satellitePreviewDebugTraceBySlug.get(slug) ?? [];

const resolveRepoRoot = () => runtimeRepoRoot;

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
const preservedChineseAdministrativeSitePattern =
  /(?:[\p{Script=Han}]{1,12}(?:市|区|县)){0,2}[\p{Script=Han}]{1,12}(?:街道|镇|乡)[\p{Script=Han}\p{L}\p{N}-]{0,16}(?:老旧小区|小区|片区|街区)$/u;
const genericChineseRegenerationSitePattern = /^老旧(?:小区|街区)$/u;
const chineseAddressNoiseLeadPattern =
  /^(?:本招标项目|本项目|项目业主|招标人为|招标代理机构为|发改委关于|省发改委关于|对(?:产业基地|项目|地块)?|主要建设内容为)/u;
const chineseLocalityNoiseLeadPattern =
  /^(?:招标代理机构为|项目业主|招标人为|本工程场地位于|本项目位于|本项目建设地点为|本项目建设地点位于)/u;
const chineseFacilityCorePattern =
  /((?:[\p{Script=Han}]{2,24}(?:大学|学院|学校|中学|小学|医院|人民医院|第一中学|第二中学|第三中学))(?:[\p{Script=Han}\p{L}\p{N}-]{0,20}?(?:校区|院区))?)/u;
const chineseRoadWithNumberPattern =
  /([\p{Script=Han}\p{L}\p{N}-]{1,30}(?:路|街(?!区)|道|巷|胡同|正街|大道)\s*\d+\s*号)/u;
const chineseRoadOnlyPattern =
  /([\p{Script=Han}\p{L}\p{N}-]{1,30}(?:路|街(?!区)|道|巷|胡同|正街|大道))/u;
const chineseInstitutionSiteTailPattern =
  /((?:[\p{Script=Han}]{2,24}(?:大学|学院|学校|中学|小学|医院))[\p{Script=Han}\p{L}\p{N}-]{0,24}?(?:校区|院区|新校区))/u;
const chineseWeakSiteNoisePattern =
  /^(?:拟规划建设中试基地|创新创业基地|实验实训基地|主要建设内容为小区|弱电设计需接驳到校区)$/u;
const chineseDirectionalSuffixPattern = /(?:内|院内|校区内|校园内|北侧|南侧|东侧|西侧|及其周边区域|及其周边区|周边区域)$/u;

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
  const deduped: AddressCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const baseKey = normalizeComparisonText(`${candidate.kind}|${candidate.address}`);
    const existingIndex = deduped.findIndex(
      (entry) => normalizeComparisonText(`${entry.kind}|${entry.address}`) === baseKey,
    );
    if (existingIndex >= 0) {
      const existing = deduped[existingIndex];
      const mergedLocalityHint = pickMoreSpecificLocalityHint(
        existing.localityHint,
        candidate.localityHint,
      );
      if (mergedLocalityHint !== existing.localityHint) {
        deduped[existingIndex] = {
          ...existing,
          localityHint: mergedLocalityHint,
        };
      }
      continue;
    }

    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
};

const dedupeRawAddressCandidates = (candidates: AddressCandidate[]) => {
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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractTrailingDashLocality = (value: string) => {
  const segments = value
    .split(/\s*[-–—]\s*/u)
    .map((segment) => cleanLocalityHint(segment))
    .filter((segment): segment is string => Boolean(segment));
  return segments.at(-1) ?? null;
};

const cleanAddressCandidate = (value: string) => {
  const cleaned = normalizeWhitespace(
    value
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/^(?:位于|坐落于|建设地点[：:]?|东至|南至|西至|北至)\s*/u, "")
      .replace(chineseAddressNoiseLeadPattern, "")
      .replace(/^(?:action)\s+/iu, "")
      .replace(/^.*?\b(?:projekt|project|projet|progetto)\s+/iu, "")
      .replace(/^.*?\b(?:przy|na\s+naslovu|sito\s+en|ubicado\s+en|situado\s+en)\s+/iu, "")
      .replace(/^(?:aan|på|pa)\s+/iu, "")
      .replace(/^.*?\b(?:fachplanung|werkraum|schule)\s+(?=[\p{L}\p{N}.'’/-]+\s+straße\b)/iu, "")
      .replace(new RegExp(String.raw`^(?:${chineseAdministrativeUnitPattern}){1,3}`, "u"), "")
      .replace(trailingAddressFieldStopPattern, "")
      .replace(
        new RegExp(
          String.raw`^((?:piazza|piazzale|plaza|platz|square|place)\s+${addressBodyPattern})\s+(?:in|a|à|en|em|nel|nella|na|no)\s+${placeNamePattern}\s*$`,
          "iu",
        ),
        "$1",
      )
      .replace(/\s*[-–—]\s*(?:lotto|lot\b|projekt(?:steuerung)?|project|projet|construction|mission|objektplanung|fachplanung|planung|raum(?:-| und )|ma[iî]trise|proc[eé]dure|procedura)\b[\s\S]*$/iu, "")
      .replace(/\s+nel\s+comune\s+di\b[\s\S]*$/iu, "")
      .replace(/\s*\([A-Z0-9-]{2,}\)\s*$/u, "")
      .replace(/\s+-\s+lot\s+\d+\b[\s\S]*$/iu, "")
      .replace(/,\s*\d+\s+logements?\b[\s\S]*$/iu, "")
      .replace(/\.\s+Nell'ambito dell['’ ]Avviso Pubblico\b[\s\S]*$/iu, "")
      .replace(/\s+finalizzat[oa]?\s+al(?:la)?\b[\s\S]*$/iu, "")
      .replace(/\s+urbanistic[oa]\b[\s\S]*$/iu, "")
      .replace(/\s+certificato\s+di\s+regolare\s+esecuzione\b[\s\S]*$/iu, "")
      .replace(/\s+N\.?C\.?E\.?U\.?\b[\s\S]*$/iu, "")
      .replace(/\b(?:项目|工程|招标公告|招标|建设项目|方案设计|初步设计|施工图设计|设计服务)\b[\s\S]*$/u, "")
      .replace(chineseDirectionalSuffixPattern, "")
      .replace(/\s+(?:w|v|u)\s+[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,4}\s*$/iu, "")
      .replace(/\s+\b(?:al\s+patrimonio\s+del\s+comune\s+di|al\s+massimo\s+\d+\s+caratteri|indietro|avanti|grazie)\b[\s\S]*$/iu, "")
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

  if (
    !new RegExp(
      String.raw`(?:\b${streetNumberBodyPattern}\b|${trailingStreetTypePattern}\b|${chineseCompoundPlacePattern}|${chineseRoadPattern})`,
      "iu",
    ).test(cleaned) &&
    rejectedProceduralAddressPattern.test(cleaned)
  ) {
    return null;
  }

  if (
    new RegExp(String.raw`^(?:${addressPrefixPattern}|${trailingStreetTypePattern})$`, "iu").test(
      cleaned,
    )
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
  (() => {
    const normalizedValue = value.replace(/^\d{4}年/u, "").replace(/(?:[«»"“”])/gu, "");
    if (preservedChineseAdministrativeSitePattern.test(normalizedValue)) {
      const preservedCleaned = normalizeWhitespace(
        normalizedValue
          .replace(/\b(?:项目|工程|招标公告|招标|建设项目|方案设计|初步设计|施工图设计|设计服务)\b[\s\S]*$/u, "")
          .replace(/^[,;:\-.\s]+|[,;:\-.\s]+$/g, ""),
      );
      if (
        !preservedCleaned ||
        preservedCleaned.length > 96 ||
        rejectedAddressMarkers.test(preservedCleaned) ||
        rejectedAddressCandidatePattern.test(preservedCleaned)
      ) {
        return null;
      }

      return preservedCleaned;
    }

    return cleanAddressCandidate(
      normalizedValue
        .replace(new RegExp(String.raw`^(?:${chineseAdministrativeUnitPattern}){1,3}`, "u"), "")
        .replace(/^[\p{Script=Han}]{2,12}(?:医院|学校)/u, "")
        .replace(/((?:片区|片小区|小区|街区))\d{4}年老旧(?:小区|街区)$/u, "$1")
        .replace(/((?:片区|片小区|小区|街区))(?:改造工程|改造项目|修复改造|建设项目)[\s\S]*$/u, "$1")
        .replace(/\s+(?:à|en|em|w|v|u|im|am|bei|auf|nel|nella|in|na|no|te|i)\s+[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,5}\s*(?:\([A-Z]{2}\))?$/iu, "")
        .replace(/\s+(?:comprensivo|incluye|including)\b[\s\S]*$/iu, "")
        .replace(/\s+(?:mission|ma[iî]trise|travaux|construction|consultation|lot|n[°ºo]\s*op[\p{L}\p{N}-]*)\b[\s\S]*$/iu, "")
        .replace(/\s*\([^)]+\)\s*$/u, ""),
    );
  })();

const cleanLocalityHint = (value: string) => {
  const cleaned = normalizeWhitespace(
    value
      .replace(/^\d{4}年/u, "")
      .replace(/^年/u, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(chineseLocalityNoiseLeadPattern, "")
      .replace(/^(?:nel|nella|nello|nei|negli|in|a)\s+comune\s+di\s+/iu, "")
      .replace(/^comune\s+di\s+/iu, "")
      .replace(/^(?:nel|nella|nello|nei|negli|in|a)\s+/iu, "")
      .replace(trailingAddressFieldStopPattern, "")
      .replace(/\d+号棚户区[\s\S]*$/u, "")
      .replace(/棚户区改造项目[\s\S]*$/u, "")
      .replace(/棚户区[\s\S]*$/u, "")
      .replace(/号$/u, "")
      .replace(/,\s*(?:district|distrito)\b[\s\S]*$/iu, "")
      .replace(/,\s*[^,]*\b(?:district|distrito)\b[\s\S]*$/iu, "")
      .replace(/\s+de\s+esta\s+localidad\b[\s\S]*$/iu, "")
      .replace(/\s+di\s+questa\s+localit[aà]\b[\s\S]*$/iu, "")
      .replace(/\s+desta\s+localidade\b[\s\S]*$/iu, "")
      .replace(/号及其周边(?:区域|区)$/u, "")
      .replace(/\s*\([A-Z]{2}\)\s*$/u, "")
      .replace(/\s*\((?:\d{2,5})\)\s*$/u, "")
      .replace(/\s+\d{2,5}\s*$/u, "")
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

  if (rejectedBroadChineseLocalityPattern.test(cleaned) || multiLocalityConnectorPattern.test(cleaned)) {
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
    new RegExp(String.raw`^\s*,\s*à\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+à\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*,\s*(?:au|aux|sur|sous|l[eè]s)\s+(${placeNamePattern})(?:\s*\((?:\d{2,5}|[A-Z]{2})\))?`, "iu"),
    new RegExp(String.raw`^\s+(?:au|aux|sur|sous|l[eè]s)\s+(${placeNamePattern})(?:\s*\((?:\d{2,5}|[A-Z]{2})\))?`, "iu"),
    new RegExp(String.raw`^\s+(?:nel|in|a|na|no|te|i)\s+(${placeNamePattern})\s*\([A-Z]{2}\)`, "iu"),
    new RegExp(String.raw`^\s+(?:nel|in|a|na|no|te|i)\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+(?:im|am|bei|auf)\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*-\s*(${placeNamePattern})\s*\([A-Z]{2}\)`, "u"),
    new RegExp(String.raw`^\s*-\s*(${placeNamePattern})\s*\((?:\d{2,5}|[A-Z]{2})\)`, "u"),
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
    new RegExp(
      String.raw`^(?:piazza|piazzale|plaza|platz|square|place)\s+${addressBodyPattern}\s+(?:in|a|à|en|em|nel|nella|na|no)\s+(${placeNamePattern})\s*$`,
      "iu",
    ),
    new RegExp(String.raw`\s+(?:w|v|u)\s+(${placeNamePattern})\s*$`, "iu"),
    new RegExp(String.raw`((?:${chineseAdministrativeUnitPattern}){1,3})\s*[\p{Script=Han}\p{L}\p{N}-]{1,40}(?:校区|院区|园区|片区|街区|地块|小区|社区|村\d+号|村|广场|公园|基地|路|街|道|巷|胡同|正街|大道)\s*$`, "u"),
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

const extractChineseContextLocalityHint = (
  normalizedText: string,
  matchIndex: number,
  rawAddress: string,
) => {
  const normalizeChineseLocalityParts = (parts: string[]) =>
    cleanLocalityHint(
      [...new Set(parts.filter((value) => value && !/\d/.test(value) && value !== "棚户区"))].join(""),
    );

  const contextBefore = normalizedText.slice(Math.max(0, matchIndex - 96), matchIndex);
  const nearbyContext = normalizedText.slice(
    Math.max(0, matchIndex - 140),
    Math.min(normalizedText.length, matchIndex + rawAddress.length + 40),
  );
  const explicitLocationLeadMatch = nearbyContext.match(
    new RegExp(String.raw`((?:${chineseAdministrativeUnitPattern}){1,3})[^。；;\n]{0,40}?(?:位于|建设地点[：:]?)`, "u"),
  );
  if (explicitLocationLeadMatch?.[1]) {
    return cleanLocalityHint(explicitLocationLeadMatch[1]);
  }

  const nearbyAdministrativeMatches = [
    ...nearbyContext.matchAll(new RegExp(chineseAdministrativeUnitPattern, "gu")),
  ]
    .map((entry) => normalizeWhitespace(entry[0] ?? ""));
  if (nearbyAdministrativeMatches.length > 0) {
    const normalizedHint = normalizeChineseLocalityParts(nearbyAdministrativeMatches.slice(0, 4));
    if (normalizedHint) {
      return normalizedHint;
    }
  }

  const directAdministrativeMatches = [
    ...contextBefore.matchAll(new RegExp(chineseAdministrativeUnitPattern, "gu")),
  ].map((entry) => normalizeWhitespace(entry[0] ?? ""));

  if (directAdministrativeMatches.length > 0) {
    const normalizedHint = normalizeChineseLocalityParts(directAdministrativeMatches.slice(-4));
    if (normalizedHint) {
      return normalizedHint;
    }
  }

  const inlineMatch = normalizedText
    .slice(Math.max(0, matchIndex - 120), Math.min(normalizedText.length, matchIndex + rawAddress.length + 40))
    .match(new RegExp(String.raw`((?:${chineseAdministrativeUnitPattern}){1,3})[^。；;，,\n]{0,40}${rawAddress}`, "u"));

  return inlineMatch?.[1] ? cleanLocalityHint(inlineMatch[1]) : null;
};

const extractChineseStreetRoadFromSite = (value: string) => {
  const embeddedRoadMatch = value.match(chineseRoadInsideSitePattern);
  if (!embeddedRoadMatch?.[1]) {
    return null;
  }

  const road = normalizeWhitespace(embeddedRoadMatch[1]);
  const narrowedRoad = road.replace(/^.*(?=(?:[\p{Script=Han}]{2,6}(?:路|街|道)$))/u, "");
  return cleanAddressCandidate(narrowedRoad || road);
};

const extractChineseFacilityCore = (value: string) => {
  const facilityMatch = normalizeWhitespace(value).match(chineseFacilityCorePattern);
  return facilityMatch?.[1] ? cleanSiteCandidate(facilityMatch[1]) : null;
};

const extractChineseInstitutionBaseName = (value: string) => {
  const normalizedValue = normalizeWhitespace(value);
  const baseInstitutionMatch = normalizedValue.match(
    /((?:[\p{Script=Han}]{2,24}(?:大学|学院|学校|中学|小学|医院|人民医院)))/u,
  );
  return baseInstitutionMatch?.[1] ? cleanSiteCandidate(baseInstitutionMatch[1]) : null;
};

const expandChineseRoadNumberVariant = (value: string) => {
  const normalizedValue = normalizeWhitespace(value);
  if (!/[\p{Script=Han}]/u.test(normalizedValue)) {
    return null;
  }

  const spacedVariant = normalizedValue.replace(
    /((?:[\p{Script=Han}\p{L}\p{N}-]{1,30}(?:路|街(?!区)|道|巷|胡同|正街|大道)))(\d+)号/u,
    "$1 $2 号",
  );
  return spacedVariant !== normalizedValue ? spacedVariant : null;
};

const extractChineseRoadCandidates = (value: string) => {
  const normalizedValue = normalizeWhitespace(value);
  const results: string[] = [];
  const normalizeChineseRoadNumberAddress = (candidateValue: string) =>
    normalizeWhitespace(candidateValue).replace(
      /((?:[\p{Script=Han}\p{L}\p{N}-]{1,30}(?:路|街(?!区)|道|巷|胡同|正街|大道)))\s*(\d+)\s*号/u,
      "$1$2号",
    );
  const pushRoad = (candidateValue: string | null | undefined) => {
    const cleaned = candidateValue ? cleanAddressCandidate(candidateValue) : null;
    if (!cleaned || results.includes(cleaned)) {
      return;
    }

    results.push(cleaned);
  };

  normalizedValue
    .split(/[、，,；;]/u)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean)
    .forEach((segment) => {
      const preciseMatch = segment.match(chineseRoadWithNumberPattern);
      if (preciseMatch?.[1]) {
        pushRoad(normalizeChineseRoadNumberAddress(preciseMatch[1]));
      }

      const roadOnlyMatch = segment.match(chineseRoadOnlyPattern);
      if (roadOnlyMatch?.[1]) {
        pushRoad(roadOnlyMatch[1]);
      }
    });

  return results;
};

const deriveLocalityHintFromChineseAddress = (value: string) => {
  const localityParts = [...value.matchAll(new RegExp(chineseAdministrativeUnitPattern, "gu"))]
    .map((match) => normalizeWhitespace(match[0] ?? ""))
    .filter(Boolean);
  if (localityParts.length === 0) {
    return null;
  }

  return cleanLocalityHint(localityParts.join(""));
};

const isInvalidChineseStreetCandidate = (rawAddress: string, address: string) =>
  /(?:片区|街区)/u.test(rawAddress) || /(?:片区|街区)/u.test(address);

const extractGlobalChineseLocalityHint = (normalizedText: string) => {
  const directConstructionLocationMatch = normalizedText.match(
    new RegExp(String.raw`建设地点[：:]?\s*((?:${chineseAdministrativeUnitPattern}){1,4})`, "u"),
  );
  if (directConstructionLocationMatch?.[1]) {
    return cleanLocalityHint(directConstructionLocationMatch[1]);
  }

  const broaderLocationLeadMatch = normalizedText.match(
    new RegExp(String.raw`((?:${chineseAdministrativeUnitPattern}){1,4})[^。；;\n]{0,40}?(?:位于|建设地点[：:]?)`, "u"),
  );
  if (broaderLocationLeadMatch?.[1]) {
    return cleanLocalityHint(broaderLocationLeadMatch[1]);
  }

  const titleAdministrativeLeadMatch = normalizedText.match(
    new RegExp(String.raw`^(?:\d{4}年)?((?:${chineseAdministrativeUnitPattern}){1,4})`, "u"),
  );
  if (titleAdministrativeLeadMatch?.[1]) {
    return cleanLocalityHint(titleAdministrativeLeadMatch[1]);
  }

  return null;
};

const pickMoreSpecificLocalityHint = (
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
) => {
  if (typeof leftValue !== "string" || leftValue.length === 0) {
    return typeof rightValue === "string" && rightValue.length > 0 ? rightValue : null;
  }

  if (typeof rightValue !== "string" || rightValue.length === 0) {
    return leftValue;
  }

  const leftKey = normalizeComparisonText(leftValue);
  const rightKey = normalizeComparisonText(rightValue);
  if (leftKey === rightKey) {
    return leftValue.length >= rightValue.length ? leftValue : rightValue;
  }

  if (rightKey.includes(leftKey)) {
    return rightValue;
  }

  if (leftKey.includes(rightKey)) {
    return leftValue;
  }

  return leftValue.length >= rightValue.length ? leftValue : rightValue;
};

const isChineseCandidateProbablyTooBroad = (address: string, kind: AddressCandidateKind) => {
  if (chineseWeakSiteNoisePattern.test(address)) {
    return true;
  }

  if (kind === "site") {
    return /(?:位于|建设地点)/u.test(address) || address.length > 26;
  }

  return /(?:位于|建设地点|街区)/u.test(address) || address.length > 18;
};

const extractChineseAddressCandidatesFromText = (
  normalizedText: string,
  source: AddressCandidate["source"],
) => {
  const candidates: AddressCandidate[] = [];
  const seen = new Set<string>();
  const globalLocalityHint = extractGlobalChineseLocalityHint(normalizedText);
  const sentenceLocalityHint = (
    rawAddress: string,
    matchIndex: number,
    fallbackLocalityHint?: string | null,
  ) =>
    pickMoreSpecificLocalityHint(
      extractChineseContextLocalityHint(normalizedText, matchIndex, rawAddress),
      fallbackLocalityHint ?? globalLocalityHint,
    );

  const pushCandidate = (
    rawAddress: string,
    kind: AddressCandidateKind,
    matchIndex: number,
    forcedLocalityHint?: string | null,
  ) => {
    const address =
      kind === "site" ? cleanSiteCandidate(rawAddress) : cleanAddressCandidate(rawAddress);
    if (!address) {
      return;
    }

    const localityHint = sentenceLocalityHint(rawAddress, matchIndex, forcedLocalityHint);
    const candidate = {
      address,
      kind,
      localityHint,
      source,
    } satisfies AddressCandidate;
    if (kind === "street" && isInvalidChineseStreetCandidate(rawAddress, address)) {
      return;
    }
    if (isChineseCandidateProbablyTooBroad(candidate.address, candidate.kind)) {
      return;
    }
    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(candidate);
  };

  for (const match of normalizedText.matchAll(chinesePreciseSiteFieldPattern)) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const localityHint = deriveLocalityHintFromChineseAddress(rawAddress);
    pushCandidate(rawAddress, "site", match.index, localityHint);
  }

  for (const match of normalizedText.matchAll(chinesePreciseStreetFieldPattern)) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const localityHint = deriveLocalityHintFromChineseAddress(rawAddress);
    const roadCandidates = extractChineseRoadCandidates(rawAddress);
    if (roadCandidates.length > 0) {
      const preciseRoadCandidate =
        roadCandidates.find((candidateValue) => /\d+\s*号$/u.test(candidateValue)) ??
        roadCandidates[0];
      pushCandidate(
        preciseRoadCandidate,
        /\d+\s*号$/u.test(preciseRoadCandidate) ? "street_address" : "street",
        match.index ?? 0,
        localityHint,
      );
      continue;
    }

    pushCandidate(rawAddress, /\d+号$/u.test(rawAddress) ? "street_address" : "street", match.index, localityHint);
  }

  for (const match of normalizedText.matchAll(
    new RegExp(
      String.raw`(?:建设地点[：:]?|位于|坐落于)?(?:((?:${chineseAdministrativeUnitPattern}){1,3}))?[^。；;\n]{0,24}?(${chineseCompoundPlacePattern})`,
      "gu",
    ),
  )) {
    const rawAddress = normalizeWhitespace(match[2] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const explicitLocalityHint = cleanLocalityHint(match[1] ?? "");
    const address = cleanSiteCandidate(rawAddress);
    if (!address || isChineseCandidateProbablyTooBroad(address, "site")) {
      continue;
    }

    const candidate = {
      address,
      kind: "site" as const,
      localityHint: pickMoreSpecificLocalityHint(
        pickMoreSpecificLocalityHint(
          explicitLocalityHint,
          extractChineseContextLocalityHint(normalizedText, match.index, rawAddress),
        ),
        sentenceLocalityHint(rawAddress, match.index),
      ),
      source,
    } satisfies AddressCandidate;
    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);

    const embeddedRoad = extractChineseStreetRoadFromSite(candidate.address);
    if (embeddedRoad) {
      pushCandidate(embeddedRoad, "street", match.index);
    }
  }

  for (const match of normalizedText.matchAll(chineseInstitutionCampusPattern)) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const cleanedAddress = cleanSiteCandidate(rawAddress);
    if (!cleanedAddress) {
      continue;
    }

    const localityHint =
      pickMoreSpecificLocalityHint(
        extractChineseContextLocalityHint(normalizedText, match.index, rawAddress),
        sentenceLocalityHint(rawAddress, match.index),
      ) ?? rawAddress;
    const candidate = {
      address: cleanedAddress,
      kind: "site" as const,
      localityHint,
      source,
    } satisfies AddressCandidate;
    const key = getAddressCandidateComparisonKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }

    const embeddedRoad = extractChineseStreetRoadFromSite(rawAddress);
    if (embeddedRoad) {
      const roadCandidate = {
        address: embeddedRoad,
        kind: "street" as const,
        localityHint,
        source,
      } satisfies AddressCandidate;
      if (roadCandidate.address) {
        const roadKey = getAddressCandidateComparisonKey(roadCandidate);
        if (!seen.has(roadKey)) {
          seen.add(roadKey);
          candidates.push(roadCandidate);
        }
      }
    }
  }

  for (const match of normalizedText.matchAll(new RegExp(chineseAdministrativeSitePattern, "gu"))) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const cleanedAddress = cleanSiteCandidate(rawAddress);
    if (!cleanedAddress || genericChineseRegenerationSitePattern.test(cleanedAddress)) {
      continue;
    }

    const localityLead = normalizeWhitespace(
      rawAddress.match(/^(.*?(?:街道|镇|乡))/u)?.[1] ?? "",
    );
    const candidate = {
      address: cleanedAddress,
      kind: "site" as const,
      localityHint:
        pickMoreSpecificLocalityHint(
          cleanLocalityHint(localityLead),
          sentenceLocalityHint(rawAddress, match.index),
        ) ?? cleanLocalityHint(localityLead),
      source,
    } satisfies AddressCandidate;

    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  for (const match of normalizedText.matchAll(new RegExp(chineseShortSiteAnchorPattern, "gu"))) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const largerAnchorExists = candidates.some(
      (candidate) =>
        candidate.kind === "site" &&
        normalizeComparisonText(candidate.address).includes(normalizeComparisonText(rawAddress)) &&
        normalizeComparisonText(candidate.address) !== normalizeComparisonText(rawAddress),
    );
    if (largerAnchorExists) {
      continue;
    }

    const address = cleanSiteCandidate(rawAddress);
    if (!address || genericChineseRegenerationSitePattern.test(address)) {
      continue;
    }

    pushCandidate(address, "site", match.index);
  }

  for (const match of normalizedText.matchAll(new RegExp(chineseStreetAsLocalityPattern, "gu"))) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const candidate = {
      address: rawAddress.replace(/^\d{4}年/u, ""),
      kind: "locality" as const,
      localityHint: pickMoreSpecificLocalityHint(
        extractChineseContextLocalityHint(normalizedText, match.index, rawAddress),
        globalLocalityHint,
      ),
      source,
    } satisfies AddressCandidate;
    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  for (const match of normalizedText.matchAll(
    /((?:[A-Z]{1,6}\d{0,2}(?:-\d{2,6}){2,}[A-Z0-9-]*)(?:、[A-Z]{1,6}\d{0,2}(?:-\d{2,6}){2,}[A-Z0-9-]*)*)地块/gu,
  )) {
    const codes = (match[1] ?? "")
      .split("、")
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean);
    for (const code of codes) {
      const rawAddress = `${code}地块`;
      if (!rawAddress || match.index === undefined) {
        continue;
      }

      const candidate = {
        address: rawAddress,
        kind: "site" as const,
        localityHint: sentenceLocalityHint(rawAddress, match.index),
        source,
      } satisfies AddressCandidate;
      const key = getAddressCandidateComparisonKey(candidate);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }
  }

  for (const match of normalizedText.matchAll(
    new RegExp(String.raw`(?:东至|南至|西至|北至)\s*(${chineseRoadPattern})`, "gu"),
  )) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    pushCandidate(rawAddress, "street", match.index);
  }

  for (const match of normalizedText.matchAll(new RegExp(chineseDirectionalRoadPattern, "gu"))) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    pushCandidate(rawAddress, "street", match.index);
  }

  for (const match of normalizedText.matchAll(
    new RegExp(
      String.raw`(?:建设地点[：:]|建设地点|位于|坐落于)[^。；;\n]{0,80}?(${chineseRoadPattern})`,
      "gu",
    ),
  )) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    pushCandidate(rawAddress, "street", match.index);
  }

  return dedupeAddressCandidates(dedupeRawAddressCandidates(candidates));
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
  const chineseContextLocalityHint = extractChineseContextLocalityHint(
    normalizedText,
    match.index,
    rawAddress,
  );
  return {
    address,
    kind,
    localityHint:
      tailLocalityHint ??
      extractInlineLocalityHintFromAddress(rawAddress) ??
      chineseContextLocalityHint,
    source,
  } satisfies AddressCandidate;
};

const enrichTitleCandidatesWithDashLocalities = (candidates: AddressCandidate[], normalizedText: string) => {
  if (!/\s[-–—]\s/u.test(normalizedText)) {
    return candidates;
  }

  return candidates.map((candidate) => {
    if (candidate.localityHint || candidate.source !== "title") {
      return candidate;
    }

    const cityStreetMatch = normalizedText.match(
      new RegExp(
        String.raw`\b(${dashDelimitedLocalityTokenPattern}(?:\s+${dashDelimitedLocalityTokenPattern}){0,4})\s*[-–—]\s+${escapeRegExp(candidate.address)}\b`,
        "iu",
      ),
    );
    if (!cityStreetMatch?.[1]) {
      return candidate;
    }

    const localityHint = extractTrailingDashLocality(cityStreetMatch[1]);
    return localityHint
      ? {
          ...candidate,
          localityHint,
        }
      : candidate;
  });
};

const extractAddressCandidatesFromText = (
  value: string,
  source: AddressCandidate["source"],
): AddressCandidate[] => {
  const normalized = normalizeWhitespace(value.replace(/[–—]/g, "-"));
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

  for (const candidate of extractChineseAddressCandidatesFromText(normalized, source)) {
    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  if (source === "title") {
    for (const match of normalized.matchAll(frenchDashDelimitedSiteLeadPattern)) {
      if (match.index === undefined) {
        continue;
      }

      const localityHint = extractTrailingDashLocality(match[1] ?? "");
      const address = cleanSiteCandidate(match[2] ?? "");
      if (!address) {
        continue;
      }

      const candidate = {
        address,
        kind: /^(?:chemin|rue|route|avenue|avenues|boulevard|all[eé]e|impasse|quai|parvis|esplanade)\b/iu.test(
          address,
        )
          ? ("street" as const)
          : ("site" as const),
        localityHint,
        source,
      } satisfies AddressCandidate;
      const key = getAddressCandidateComparisonKey(candidate);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }

    for (const match of normalized.matchAll(frenchQuotedSiteLeadPattern)) {
      if (match.index === undefined) {
        continue;
      }

      const localityHint = extractTrailingDashLocality(match[1] ?? "");
      const address = cleanSiteCandidate(match[2] ?? "");
      if (!address) {
        continue;
      }

      const candidate = {
        address,
        kind: "site" as const,
        localityHint,
        source,
      } satisfies AddressCandidate;
      const key = getAddressCandidateComparisonKey(candidate);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }

    for (const { kind, pattern } of titleAddressCandidatePatterns) {
      for (const match of normalized.matchAll(pattern)) {
        const candidate = buildAddressCandidate(normalized, match, kind, source);
        if (!candidate) {
          continue;
        }

        if (
          candidate.kind === "street" &&
          candidates.some(
            (existingCandidate) =>
              existingCandidate.kind === "street_address" &&
              normalizeComparisonText(existingCandidate.address) ===
                normalizeComparisonText(candidate.address),
          )
        ) {
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
  }

  return dedupeAddressCandidates(dedupeRawAddressCandidates(enrichTitleCandidatesWithDashLocalities(candidates, normalized)));
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
      version?: string;
    };

    if (payload.version !== satellitePreviewRevision || !payload.entries) {
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
          version: satellitePreviewRevision,
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
      .replace(/[–—]/g, "-")
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
    value
      .replace(localityWrapperStripPattern, "")
      .replace(/^(?:nel|nella|nello|nei|negli|in|a)\s+comune\s+di\s+/iu, "")
      .replace(/^comune\s+di\s+/iu, "")
      .replace(/^(?:nel|nella|nello|nei|negli|in|a)\s+/iu, ""),
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

  const numericLeadingStreetMatch = normalizedValue.match(
    new RegExp(
      String.raw`^((?:\d+(?:\s+(?:bis|ter|quater))?|${streetNumberBodyPattern}))\s+(${addressPrefixPattern}\s+${addressBodyPattern})$`,
      "iu",
    ),
  );
  if (numericLeadingStreetMatch) {
    pushVariant(`${numericLeadingStreetMatch[2]} ${numericLeadingStreetMatch[1]}`);
  }

  const trailingStreetCoreMatch = normalizedValue.match(
    new RegExp(
      String.raw`(?:^|[\s,;:-])(${compoundTrailingStreetWordPattern}|[\p{L}\p{N}.'’/-]+\s+${trailingStreetTypePattern})$`,
      "iu",
    ),
  );
  if (trailingStreetCoreMatch?.[1]) {
    pushVariant(trailingStreetCoreMatch[1]);
  }

  const strippedSiteWrapper = normalizeWhitespace(
    normalizedValue.replace(
      /^(?:quartier|quartiers|lotissement|urbanizaci[oó]n|urbanizzazione|resid[eé]nce|residenza|parque(?:\s+empresarial)?|parco|zac|zap|zone\s+d['’](?:am[eé]nagement|activit[eé]s?)|site(?:\s+pilote)?|[iî]lot|ilot|secteur|sous-secteur|lieu-dit|groupe\s+scolaire|[eé]cole|coll[eè]ge|lyc[eé]e|gymnase|mus[eé]e|palais|complexe|centre\s+d['’]intervention)\s+(?:(?:de|del|de la|des|du|la|le|los|las)\s+)?/iu,
      "",
    ),
  );
  if (strippedSiteWrapper && strippedSiteWrapper !== normalizedValue) {
    pushVariant(strippedSiteWrapper);
  }

  const frenchSiteWithCityMatch = normalizedValue.match(
    /^(.*?)(?:\s+(?:a|à|au|aux|sur|sous|l[eè]s)\s+)([\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,4})$/iu,
  );
  if (
    frenchSiteWithCityMatch &&
    !new RegExp(String.raw`^${addressPrefixPattern}\b`, "iu").test(normalizedValue)
  ) {
    pushVariant(frenchSiteWithCityMatch[1]);
    pushVariant(`${frenchSiteWithCityMatch[1]} ${frenchSiteWithCityMatch[2]}`);
  }

  const chineseSiteMatch = normalizedValue.match(
    /^([\p{Script=Han}\p{L}\p{N}-]{1,40}(?:校区|院区|园区|片区|街区|地块|小区|社区|村\d+号|村|广场|公园|基地))$/u,
  );
  if (chineseSiteMatch) {
    pushVariant(chineseSiteMatch[1]);
  }

  const chineseFacilityCore = extractChineseFacilityCore(normalizedValue);
  if (chineseFacilityCore) {
    pushVariant(chineseFacilityCore);
  }

  const chineseInstitutionBaseName = extractChineseInstitutionBaseName(normalizedValue);
  if (chineseInstitutionBaseName) {
    pushVariant(chineseInstitutionBaseName);
  }

  const chineseInstitutionSiteMatch = normalizedValue.match(chineseInstitutionSiteTailPattern);
  if (chineseInstitutionSiteMatch?.[1]) {
    pushVariant(chineseInstitutionSiteMatch[1]);
  }

  const spacedChineseRoadNumberVariant = expandChineseRoadNumberVariant(normalizedValue);
  if (spacedChineseRoadNumberVariant) {
    pushVariant(spacedChineseRoadNumberVariant);
  }

  for (const roadCandidate of extractChineseRoadCandidates(normalizedValue)) {
    pushVariant(roadCandidate);
    const spacedRoadCandidate = expandChineseRoadNumberVariant(roadCandidate);
    if (spacedRoadCandidate) {
      pushVariant(spacedRoadCandidate);
    }
  }

  const chineseAdministrativeLeadMatch = normalizedValue.match(
    /^((?:[\p{Script=Han}]{1,12}(?:省|市|区|县|镇|乡|街道|新区)){1,4})([\p{Script=Han}\p{L}\p{N}-]{1,40}(?:村\d+号|村|地块|街区|片区|园区|基地))$/u,
  );
  if (chineseAdministrativeLeadMatch) {
    pushVariant(chineseAdministrativeLeadMatch[0]);
    pushVariant(chineseAdministrativeLeadMatch[2]);
  }

  const chineseVillageNumberMatch = normalizedValue.match(
    /^([\p{Script=Han}]{2,20}村\d+号)$/u,
  );
  if (chineseVillageNumberMatch) {
    pushVariant(chineseVillageNumberMatch[1]);
    pushVariant(chineseVillageNumberMatch[1].replace(/\d+号$/u, ""));
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

  if (!normalized) {
    return null;
  }

  const chineseCityMatch = normalized.match(/^([\p{Script=Han}]{2,12})(?:城市|市)$/u);
  if (chineseCityMatch?.[1]) {
    return chineseCityMatch[1];
  }

  return normalized;
};

const buildLocalityCandidate = (
  value: string | null | undefined,
  source: AddressCandidate["source"],
): AddressCandidate | null => {
  const sanitizedLocation = sanitizeOpportunityLocationLabel(value);
  if (!sanitizedLocation) {
    return null;
  }

  if (multiLocalityConnectorPattern.test(sanitizedLocation) || rejectedBroadChineseLocalityPattern.test(sanitizedLocation)) {
    return null;
  }

  return {
    address: sanitizedLocation,
    kind: "locality",
    localityHint: null,
    source,
  } satisfies AddressCandidate;
};

const buildLocalityCandidatesFromAddressHints = (candidates: AddressCandidate[]) =>
  dedupeAddressCandidates(
    candidates.flatMap((candidate) => {
      const localityCandidate = buildLocalityCandidate(cleanLocalityHint(candidate.localityHint ?? ""), candidate.source);
      if (!localityCandidate) {
        return [];
      }

      return normalizeComparisonText(localityCandidate.address) ===
        normalizeComparisonText(candidate.address)
        ? []
        : [localityCandidate];
    }),
  );

const resolveOpportunityLocalityCandidates = (opportunity: SatellitePreviewInput) =>
  dedupeAddressCandidates(
    [
      buildLocalityCandidate(pickOpportunityDisplayLocality(opportunity), "title"),
      sanitizeOpportunityLocationLabel(opportunity.locationLabel) &&
      sanitizeOpportunityLocationLabel(opportunity.locationLabel) !== opportunity.locationLabel
        ? buildLocalityCandidate(sanitizeOpportunityLocationLabel(opportunity.locationLabel), "page")
        : null,
      buildLocalityCandidate(pickOpportunityExplicitCity(opportunity), "title"),
    ].flatMap((candidate) => (candidate ? [candidate] : [])),
  );

type GeocodeQueryOptions = {
  includeExplicitCity?: boolean;
  includeLocationLabel?: boolean;
  includeJurisdictionLabel?: boolean;
};

const buildGeocodeQueries = (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
  options: GeocodeQueryOptions = {},
) => {
  const explicitCity =
    options.includeExplicitCity === false ? null : pickOpportunityDisplayLocality(opportunity);
  const addressVariants = expandAddressVariantsForGeocoder(candidate.address);
  const localityVariants = expandLocalityVariantsForGeocoder(candidate.localityHint);
  const localityOptions = localityVariants.length > 0 ? localityVariants : [null];
  const seenQueries = new Set<string>();
  const queries: string[] = [];
  const includeLocationLabel = options.includeLocationLabel !== false;
  const includeJurisdictionLabel = options.includeJurisdictionLabel !== false;

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

      if (candidate.kind === "locality") {
        pushPart(normalizeLocalityForGeocoderSearch(addressVariant));
      } else {
        pushPart(addressVariant);
      }
      pushPart(normalizeLocalityForGeocoderSearch(normalizeLocalityHintForGeocoder(localityVariant)));
      pushPart(normalizeLocalityForGeocoderSearch(explicitCity));
      if (includeLocationLabel) {
        pushPart(normalizeLocalityForGeocoderSearch(sanitizeOpportunityLocationLabel(opportunity.locationLabel)));
      }
      if (includeJurisdictionLabel) {
        pushPart(opportunity.jurisdictionLabel);
      }

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

const resolveGeocodeQueries = (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
) => buildGeocodeQueries(opportunity, candidate);

const resolveFallbackGeocodeQueries = (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
) => {
  const strippedAddress = stripLeadingStreetPrefixForGeocoder(candidate.address);
  const explicitCity = normalizeLocalityForGeocoderSearch(pickOpportunityDisplayLocality(opportunity));
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

  const fallbackQueries = [
    ...buildGeocodeQueries(opportunity, fallbackCandidate),
    ...buildGeocodeQueries(opportunity, fallbackCandidate, {
      includeJurisdictionLabel: false,
    }),
    ...buildGeocodeQueries(opportunity, fallbackCandidate, {
      includeJurisdictionLabel: false,
      includeLocationLabel: false,
    }),
    ...(candidate.kind === "locality"
      ? []
      : buildGeocodeQueries(opportunity, fallbackCandidate, {
          includeExplicitCity: false,
          includeJurisdictionLabel: false,
          includeLocationLabel: false,
        })),
  ];

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

const normalizeChinesePlaceStem = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return "";
  }

  return normalizeWhitespace(value)
    .replace(/[^\p{Script=Han}\p{N}]+/gu, "")
    .replace(/\d+号?$/u, "")
    .replace(/(?:管委会|政务中心|医疗服务中心|第一实验学校|中学|学校|南口|西口|东口|北口)$/u, "")
    .replace(/(?:托幼用地|二类居住用地|产业园区|科技园区|建设项目|项目)$/u, "")
    .replace(/(?:地块.*|片区.*|街区.*|园区.*|基地.*)$/u, "");
};

const haveChineseLoosePlaceMatch = (
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
) => {
  const left = normalizeChinesePlaceStem(leftValue);
  const right = normalizeChinesePlaceStem(rightValue);
  if (!left || !right) {
    return false;
  }

  return left.includes(right) || right.includes(left);
};

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
    normalizeLocalityForGeocoderSearch(pickOpportunityDisplayLocality(opportunity)) ??
    normalizeLocalityForGeocoderSearch(sanitizeOpportunityLocationLabel(opportunity.locationLabel));
  const featureLocality = normalizePhotonLocalityValue(feature);
  const candidateLooksChinese =
    /[\p{Script=Han}]/u.test(candidate.address) ||
    /[\p{Script=Han}]/u.test(candidate.localityHint ?? "");
  const candidateHouseNumber = extractComparableHouseNumber(candidate.address);
  const featureHouseNumber = extractComparableHouseNumber(feature.properties?.housenumber ?? null);
  const countryTokens = resolveCountryComparisonTokens(opportunity.jurisdictionKey);
  const featureCountryTokens = splitComparisonTokens(feature.properties?.country ?? "");
  const featureName = feature.properties?.name ?? null;

  if (candidate.kind === "locality") {
    if (countryTokens.length > 0 && !countryTokens.some((token) => featureCountryTokens.includes(token))) {
      return false;
    }

    if (
      haveLocalityTokenMatch(candidate.address, featureName) ||
      (candidateLooksChinese && haveChineseLoosePlaceMatch(candidate.address, featureName))
    ) {
      return true;
    }

    return localityHint ? haveLocalityTokenMatch(localityHint, featureLocality) : true;
  }

  if (candidateHouseNumber && featureHouseNumber && candidateHouseNumber !== featureHouseNumber) {
    return false;
  }

  if (countryTokens.length > 0 && !countryTokens.some((token) => featureCountryTokens.includes(token))) {
    return false;
  }

  if (!haveStreetCoreTokenMatch(candidate.address, featureStreet)) {
    if (
      !(
        candidateLooksChinese &&
        (haveStreetCoreTokenMatch(candidate.address, featureName) ||
          haveLocalityTokenMatch(candidate.address, featureName) ||
          haveChineseLoosePlaceMatch(candidate.address, featureName))
      )
    ) {
      return false;
    }
  }

  if (
    localityHint &&
    !haveLocalityTokenMatch(localityHint, featureLocality) &&
    !(candidateLooksChinese && haveChineseLoosePlaceMatch(localityHint, featureLocality))
  ) {
    return false;
  }

  return true;
};

const geocodeViaPhoton = async (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
): Promise<GeocodeResult | null> => {
  const addressVariants =
    candidate.kind === "locality"
      ? expandLocalityVariantsForGeocoder(candidate.address)
      : expandAddressVariantsForGeocoder(candidate.address);

  for (const addressVariant of addressVariants) {
    const query = normalizeWhitespace(
      [
        normalizeLocalityForGeocoderSearch(addressVariant) ?? addressVariant,
        normalizeLocalityForGeocoderSearch(normalizeLocalityHintForGeocoder(candidate.localityHint)),
        normalizeLocalityForGeocoderSearch(pickOpportunityDisplayLocality(opportunity)),
        normalizeLocalityForGeocoderSearch(sanitizeOpportunityLocationLabel(opportunity.locationLabel)),
        opportunity.jurisdictionLabel,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" "),
    );

    if (!query) {
      continue;
    }

    const cacheKey = buildProviderGeocodeCacheKey("photon", query);
    if (geocodeMemoryCache.has(cacheKey)) {
      const cached = geocodeMemoryCache.get(cacheKey);
      if (cached) {
        return {
          lat: cached.lat,
          lng: cached.lng,
          precision: cached.precision ?? getDefaultPrecisionForCandidate(candidate),
        };
      }

      continue;
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
        debugSatellitePreview(opportunity.slug, "photon-non-ok", query, response.status);
        geocodeMemoryCache.set(cacheKey, null);
        await saveGeocodeCache();
        continue;
      }

      const payload = (await response.json()) as PhotonSearchResult | undefined;
      const firstMatchingFeature = payload?.features?.find((feature) =>
        doesPhotonFeatureMatchCandidate(feature, candidate, opportunity),
      );
      const coordinates = firstMatchingFeature?.geometry?.coordinates;
      if (!coordinates || coordinates.length < 2) {
        debugSatellitePreview(opportunity.slug, "photon-no-coordinates", query);
        geocodeMemoryCache.set(cacheKey, null);
        await saveGeocodeCache();
        continue;
      }

      const [lng, lat] = coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        geocodeMemoryCache.set(cacheKey, null);
        await saveGeocodeCache();
        continue;
      }

      const result = {
        lat,
        lng,
        precision: getDefaultPrecisionForCandidate(candidate),
      } satisfies GeocodeResult;
      debugSatellitePreview(opportunity.slug, "photon-hit", query, result);
      geocodeMemoryCache.set(cacheKey, result);
      await saveGeocodeCache();
      return result;
    } catch {
      debugSatellitePreview(opportunity.slug, "photon-error", query);
    }
  }

  return null;
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

const resolveGeocodePrecision = (
  result: Pick<NominatimSearchResult, "addresstype" | "type">,
  candidate: AddressCandidate,
): SatellitePreviewPrecision => {
  const addresstype = result.addresstype?.toLowerCase() ?? "";
  const type = result.type?.toLowerCase() ?? "";
  const kind = addresstype || type;

  if (candidate.kind === "locality") {
    return kind === "city" || kind === "town" || kind === "municipality" ? "locality" : "locality";
  }

  if (candidate.kind === "site") {
    return kind === "square" ? "square" : "site";
  }

  if (kind === "square") {
    return "square";
  }

  if (kind === "city" || kind === "town" || kind === "municipality") {
    return "city";
  }

  if (candidate.kind === "street_address") {
    return "address";
  }

  return "street";
};

const isBroadStreetLikeResult = (result: NominatimSearchResult) => {
  const addresstype = result.addresstype?.toLowerCase() ?? "";
  const type = result.type?.toLowerCase() ?? "";
  return acceptedBroadGeocodeAddressTypes.has(addresstype) || acceptedBroadGeocodeAddressTypes.has(type);
};

const getDefaultPrecisionForCandidate = (
  candidate: Pick<AddressCandidate, "address" | "kind">,
): SatellitePreviewPrecision => {
  if (candidate.kind === "locality") {
    return "locality";
  }

  if (candidate.kind === "site") {
    return "site";
  }

  if (candidate.kind === "street_address") {
    return "address";
  }

  return hasStreetNumber(candidate.address) ? "address" : "street";
};

const parseFiniteCoordinate = (value: number | string | null | undefined) => {
  const numericValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numericValue) ? numericValue : null;
};

const buildBaiduSignedUrl = (
  baseUrl: string,
  params: URLSearchParams,
) => {
  const url = new URL(baseUrl);
  const requestPath = url.pathname || "/";
  const unsignedQuery = params.toString();
  if (!baiduGeocoderSk) {
    return `${baseUrl}?${unsignedQuery}`;
  }

  const rawSignature = `${requestPath}?${unsignedQuery}${baiduGeocoderSk}`;
  const encodedSignatureSeed = encodeURIComponent(rawSignature);
  const sn = createHash("md5").update(encodedSignatureSeed).digest("hex");
  return `${baseUrl}?${unsignedQuery}&sn=${sn}`;
};

const resolveChineseGeocodePrecision = (
  candidate: AddressCandidate,
  level: string | null | undefined,
) => {
  const normalizedLevel = level?.trim().toLowerCase() ?? "";
  if (
    normalizedLevel === "门址" ||
    normalizedLevel === "门牌号" ||
    normalizedLevel === "house number" ||
    normalizedLevel === "门址点"
  ) {
    return "address";
  }

  if (
    normalizedLevel === "道路" ||
    normalizedLevel === "street" ||
    normalizedLevel === "road" ||
    normalizedLevel === "乡镇街道"
  ) {
    return candidate.kind === "locality" ? "locality" : "street";
  }

  if (
    normalizedLevel === "兴趣点" ||
    normalizedLevel === "poi" ||
    normalizedLevel === "开发区" ||
    normalizedLevel === "村庄" ||
    normalizedLevel === "landmark"
  ) {
    return candidate.kind === "locality" ? "locality" : "site";
  }

  if (
    normalizedLevel === "区县" ||
    normalizedLevel === "city" ||
    normalizedLevel === "city区" ||
    normalizedLevel === "乡镇" ||
    normalizedLevel === "district" ||
    normalizedLevel === "country"
  ) {
    return candidate.kind === "locality" ? "locality" : "city";
  }

  return getDefaultPrecisionForCandidate(candidate);
};

const isAcceptableBaiduGeocodeResult = (
  result: BaiduGeocodeResult,
  candidate: AddressCandidate,
) => {
  const lat = parseFiniteCoordinate(result.location?.lat);
  const lng = parseFiniteCoordinate(result.location?.lng);
  if (lat === null || lng === null) {
    return false;
  }

  const confidence = parseFiniteCoordinate(result.confidence);
  const precise = parseFiniteCoordinate(result.precise);
  const level = result.level?.trim().toLowerCase() ?? "";

  if (candidate.kind === "locality") {
    return true;
  }

  if (candidate.kind === "street_address") {
    if (precise === 1) {
      return true;
    }

    return (confidence ?? 0) >= 45;
  }

  if (candidate.kind === "site") {
    if (level.includes("poi") || level.includes("兴趣点")) {
      return true;
    }

    return (confidence ?? 0) >= 30;
  }

  if (candidate.kind === "street") {
    if (
      level.includes("road") ||
      level.includes("street") ||
      level.includes("道路") ||
      level.includes("乡镇街道")
    ) {
      return true;
    }

    return (confidence ?? 0) >= 30;
  }

  return true;
};

const isAcceptableAmapGeocodeResult = (
  result: AmapGeocodeResult,
  candidate: AddressCandidate,
) => {
  const location = result.location?.split(",");
  if (!location || location.length < 2) {
    return false;
  }

  const lng = parseFiniteCoordinate(location[0]);
  const lat = parseFiniteCoordinate(location[1]);
  if (lat === null || lng === null) {
    return false;
  }

  const level = result.level?.trim().toLowerCase() ?? "";
  if (candidate.kind === "locality") {
    return true;
  }

  if (candidate.kind === "street_address") {
    return (
      level === "门牌号" ||
      level === "道路" ||
      level === "street" ||
      level === "road" ||
      hasStreetNumber(candidate.address)
    );
  }

  if (candidate.kind === "street") {
    return level !== "省" && level !== "city" && level !== "区县";
  }

  if (candidate.kind === "site") {
    return level !== "省";
  }

  return true;
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
  const isLocalityCandidate = candidate.kind === "locality";

  if (!isLocalityCandidate && (rejectedGeocodeAddressTypes.has(addresstype) || rejectedGeocodeAddressTypes.has(type))) {
    return false;
  }

  if (category && !acceptedGeocodeCategories.has(category)) {
    if (candidate.kind === "locality" && acceptedLocalityGeocodeCategories.has(category)) {
      // Administrative boundary results are expected for city/locality lookups.
    } else
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
    if (!(candidate.kind === "street" && isBroadStreetLikeResult(result))) {
      return false;
    }
  }

  if (diagonalKm === null) {
    return true;
  }

  if (candidate.kind === "locality") {
    if (addresstype === "city" || type === "city" || addresstype === "town" || type === "town") {
      return diagonalKm <= 14;
    }

    if (addresstype === "municipality" || type === "municipality") {
      return diagonalKm <= 10;
    }

    return diagonalKm <= 18;
  }

  if (candidate.kind === "site") {
    return diagonalKm <= 8;
  }

  if (candidate.kind === "street_address") {
    return diagonalKm <= 4;
  }

  return diagonalKm <= 18;
};

const geocodeViaBaidu = async (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
  query: string,
): Promise<GeocodeResult | null> => {
  if (!baiduGeocoderAk) {
    return null;
  }

  const cacheKey = buildProviderGeocodeCacheKey("baidu", query);
  if (geocodeMemoryCache.has(cacheKey)) {
    const cached = geocodeMemoryCache.get(cacheKey);
    if (cached) {
      return {
        lat: cached.lat,
        lng: cached.lng,
        precision: cached.precision ?? getDefaultPrecisionForCandidate(candidate),
      };
    }

    return null;
  }

  try {
    const params = new URLSearchParams({
      address: query,
      ak: baiduGeocoderAk,
      output: "json",
      ret_coordtype: "bd09ll",
    });
    const response = await fetch(buildBaiduSignedUrl(baiduGeocoderUrl, params), {
      headers: {
        accept: "application/json",
        "user-agent": "arch-competition-ops/0.1 satellite-preview",
      },
      signal: AbortSignal.timeout(geocodeRequestTimeoutMs),
    });

    if (!response.ok) {
      debugSatellitePreview(opportunity.slug, "baidu-non-ok", query, response.status);
      geocodeMemoryCache.set(cacheKey, null);
      await saveGeocodeCache();
      return null;
    }

    const payload = (await response.json()) as BaiduGeocodeResponse | undefined;
    const accepted = payload?.status === 0 || payload?.status === "0"
      ? payload.result ?? null
      : null;
    if (!accepted || !isAcceptableBaiduGeocodeResult(accepted, candidate)) {
      debugSatellitePreview(
        opportunity.slug,
        "baidu-rejected",
        query,
        payload?.status ?? null,
        accepted?.level ?? null,
      );
      geocodeMemoryCache.set(cacheKey, null);
      await saveGeocodeCache();
      return null;
    }

    const rawLat = parseFiniteCoordinate(accepted.location?.lat);
    const rawLng = parseFiniteCoordinate(accepted.location?.lng);
    if (rawLat === null || rawLng === null) {
      geocodeMemoryCache.set(cacheKey, null);
      await saveGeocodeCache();
      return null;
    }

    const normalizedCoordinates = bd09ToWgs84(rawLat, rawLng);
    const result = {
      lat: normalizedCoordinates.lat,
      lng: normalizedCoordinates.lng,
      precision: resolveChineseGeocodePrecision(candidate, accepted.level),
    } satisfies GeocodeResult;
    debugSatellitePreview(opportunity.slug, "baidu-hit", query, result);
    geocodeMemoryCache.set(cacheKey, result);
    await saveGeocodeCache();
    return result;
  } catch {
    debugSatellitePreview(opportunity.slug, "baidu-error", query);
    return null;
  }
};

const geocodeViaAmap = async (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
  query: string,
): Promise<GeocodeResult | null> => {
  if (!amapGeocoderKey) {
    return null;
  }

  const cacheKey = buildProviderGeocodeCacheKey("amap", query);
  if (geocodeMemoryCache.has(cacheKey)) {
    const cached = geocodeMemoryCache.get(cacheKey);
    if (cached) {
      return {
        lat: cached.lat,
        lng: cached.lng,
        precision: cached.precision ?? getDefaultPrecisionForCandidate(candidate),
      };
    }

    return null;
  }

  try {
    const params = new URLSearchParams({
      address: query,
      key: amapGeocoderKey,
      output: "json",
    });
    const response = await fetch(`${amapGeocoderUrl}?${params.toString()}`, {
      headers: {
        accept: "application/json",
        "user-agent": "arch-competition-ops/0.1 satellite-preview",
      },
      signal: AbortSignal.timeout(geocodeRequestTimeoutMs),
    });

    if (!response.ok) {
      debugSatellitePreview(opportunity.slug, "amap-non-ok", query, response.status);
      geocodeMemoryCache.set(cacheKey, null);
      await saveGeocodeCache();
      return null;
    }

    const payload = (await response.json()) as AmapGeocodeResponse | undefined;
    const first = payload?.geocodes?.[0];
    if (
      !first ||
      !(payload?.status === "1" || payload?.status === 1) ||
      !isAcceptableAmapGeocodeResult(first, candidate)
    ) {
      debugSatellitePreview(
        opportunity.slug,
        "amap-rejected",
        query,
        payload?.status ?? null,
        first?.level ?? null,
      );
      geocodeMemoryCache.set(cacheKey, null);
      await saveGeocodeCache();
      return null;
    }

    const [rawLngValue, rawLatValue] = first.location?.split(",") ?? [];
    const rawLat = parseFiniteCoordinate(rawLatValue);
    const rawLng = parseFiniteCoordinate(rawLngValue);
    if (rawLat === null || rawLng === null) {
      geocodeMemoryCache.set(cacheKey, null);
      await saveGeocodeCache();
      return null;
    }

    const normalizedCoordinates = gcj02ToWgs84(rawLat, rawLng);
    const result = {
      lat: normalizedCoordinates.lat,
      lng: normalizedCoordinates.lng,
      precision: resolveChineseGeocodePrecision(candidate, first.level),
    } satisfies GeocodeResult;
    debugSatellitePreview(opportunity.slug, "amap-hit", query, result);
    geocodeMemoryCache.set(cacheKey, result);
    await saveGeocodeCache();
    return result;
  } catch {
    debugSatellitePreview(opportunity.slug, "amap-error", query);
    return null;
  }
};

const geocodeViaChinaProviders = async (
  opportunity: SatellitePreviewInput,
  candidate: AddressCandidate,
  queries: string[],
) => {
  if (!isChinaJurisdiction(opportunity)) {
    return null;
  }

  for (const query of queries) {
    const baiduResult = await geocodeViaBaidu(opportunity, candidate, query);
    if (baiduResult) {
      return baiduResult;
    }

    const amapResult = await geocodeViaAmap(opportunity, candidate, query);
    if (amapResult) {
      return amapResult;
    }
  }

  return null;
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
  const allQueries = [...queries, ...fallbackQueries];
  const countryCode = countryCodeByJurisdiction[normalizeJurisdictionKey(opportunity.jurisdictionKey) ?? ""];

  const chinaProviderResult = await geocodeViaChinaProviders(opportunity, candidate, allQueries);
  if (chinaProviderResult) {
    return chinaProviderResult;
  }

  for (const query of allQueries) {
    const cacheKey = buildProviderGeocodeCacheKey("nominatim", query);
    if (geocodeMemoryCache.has(cacheKey)) {
      const cached = geocodeMemoryCache.get(cacheKey);
      if (cached) {
        return {
          lat: cached.lat,
          lng: cached.lng,
          precision: cached.precision ?? getDefaultPrecisionForCandidate(candidate),
        };
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
        debugSatellitePreview(opportunity.slug, "nominatim-non-ok", query, response.status);
        geocodeMemoryCache.set(cacheKey, null);
        await saveGeocodeCache();
        continue;
      }

      const payload = (await response.json()) as NominatimSearchResult[] | undefined;
      const first = Array.isArray(payload) ? payload[0] : undefined;
      const accepted = Array.isArray(payload)
        ? payload.find((entry) => isAcceptableGeocodeResult(entry, candidate))
        : undefined;
      if (!accepted) {
        debugSatellitePreview(opportunity.slug, "nominatim-rejected", query, first?.display_name ?? null);
        geocodeMemoryCache.set(cacheKey, null);
        await saveGeocodeCache();
        continue;
      }

      const lat = Number(accepted?.lat);
      const lng = Number(accepted?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        debugSatellitePreview(opportunity.slug, "nominatim-invalid-coordinates", query);
        geocodeMemoryCache.set(cacheKey, null);
        await saveGeocodeCache();
        continue;
      }

      const result = {
        lat,
        lng,
        precision: resolveGeocodePrecision(accepted, candidate),
      };
      debugSatellitePreview(opportunity.slug, "nominatim-hit", query, result);
      geocodeMemoryCache.set(cacheKey, result);
      await saveGeocodeCache();
      return result;
    } catch {
      debugSatellitePreview(opportunity.slug, "nominatim-error", query);
      continue;
    }
  }

  if (
    candidate.kind === "street_address" ||
    candidate.kind === "street" ||
    candidate.kind === "site" ||
    candidate.kind === "locality"
  ) {
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

const getPrecisionZoom = (
  candidate: AddressCandidate,
  precision: SatellitePreviewPrecision,
) => {
  if (precision === "city") {
    return 13;
  }

  if (precision === "locality") {
    return satelliteZoomWithLocality;
  }

  if (precision === "square") {
    return 16;
  }

  if (precision === "site") {
    return 16;
  }

  if (precision === "street") {
    return 16;
  }

  return hasStreetNumber(candidate.address)
    ? satelliteZoomWithStreetNumber
    : satelliteZoomWithoutStreetNumber;
};

const getPrecisionCircleRadiusPx = (precision: SatellitePreviewPrecision) => {
  switch (precision) {
    case "city":
      return 118;
    case "locality":
      return 92;
    case "square":
      return 58;
    case "site":
      return 52;
    case "street":
      return 40;
    default:
      return 28;
  }
};

const isChinaJurisdiction = (opportunity: SatellitePreviewInput) =>
  normalizeJurisdictionKey(opportunity.jurisdictionKey) === "china";

const degreesToRadians = (value: number) => value * (Math.PI / 180);

const chinaCoordinateTransformLat = (
  lngOffset: number,
  latOffset: number,
) => {
  let result =
    -100 +
    2 * lngOffset +
    3 * latOffset +
    0.2 * latOffset * latOffset +
    0.1 * lngOffset * latOffset +
    0.2 * Math.sqrt(Math.abs(lngOffset));
  result +=
    ((20 * Math.sin(6 * lngOffset * Math.PI) + 20 * Math.sin(2 * lngOffset * Math.PI)) * 2) /
    3;
  result +=
    ((20 * Math.sin(latOffset * Math.PI) + 40 * Math.sin((latOffset / 3) * Math.PI)) * 2) / 3;
  result +=
    ((160 * Math.sin((latOffset / 12) * Math.PI) + 320 * Math.sin((latOffset * Math.PI) / 30)) *
      2) /
    3;
  return result;
};

const chinaCoordinateTransformLng = (
  lngOffset: number,
  latOffset: number,
) => {
  let result =
    300 +
    lngOffset +
    2 * latOffset +
    0.1 * lngOffset * lngOffset +
    0.1 * lngOffset * latOffset +
    0.1 * Math.sqrt(Math.abs(lngOffset));
  result +=
    ((20 * Math.sin(6 * lngOffset * Math.PI) + 20 * Math.sin(2 * lngOffset * Math.PI)) * 2) /
    3;
  result +=
    ((20 * Math.sin(lngOffset * Math.PI) + 40 * Math.sin((lngOffset / 3) * Math.PI)) * 2) / 3;
  result +=
    ((150 * Math.sin((lngOffset / 12) * Math.PI) + 300 * Math.sin((lngOffset / 30) * Math.PI)) *
      2) /
    3;
  return result;
};

const isOutsideChina = (lat: number, lng: number) =>
  lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;

const gcj02ToWgs84 = (lat: number, lng: number) => {
  if (isOutsideChina(lat, lng)) {
    return { lat, lng };
  }

  const a = 6378245;
  const ee = 0.00669342162296594323;
  const lngOffset = lng - 105;
  const latOffset = lat - 35;
  let deltaLat = chinaCoordinateTransformLat(lngOffset, latOffset);
  let deltaLng = chinaCoordinateTransformLng(lngOffset, latOffset);
  const radLat = degreesToRadians(lat);
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  deltaLat =
    (deltaLat * 180) /
    (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  deltaLng =
    (deltaLng * 180) /
    ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);

  return {
    lat: lat - deltaLat,
    lng: lng - deltaLng,
  };
};

const bd09ToGcj02 = (lat: number, lng: number) => {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000 / 180);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000 / 180);
  return {
    lat: z * Math.sin(theta),
    lng: z * Math.cos(theta),
  };
};

const bd09ToWgs84 = (lat: number, lng: number) => {
  const gcj02 = bd09ToGcj02(lat, lng);
  return gcj02ToWgs84(gcj02.lat, gcj02.lng);
};

const buildPrecisionCircleOverlay = (precision: SatellitePreviewPrecision) => {
  const radius = getPrecisionCircleRadiusPx(precision);
  const center = satelliteImageSize / 2;
  const haloRadius = radius + 18;
  const label =
    precision === "city"
      ? "CITY"
      : precision === "locality"
        ? "LOCALITY"
        : precision === "square"
          ? "SQUARE"
          : precision === "site"
            ? "SITE"
            : precision === "street"
              ? "STREET"
              : "ADDRESS";

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${satelliteImageSize}" height="${satelliteImageSize}" viewBox="0 0 ${satelliteImageSize} ${satelliteImageSize}">
      <defs>
        <filter id="ring-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#09110d" flood-opacity="0.28" />
        </filter>
      </defs>
      <circle cx="${center}" cy="${center}" r="${haloRadius}" fill="#d9f2de" fill-opacity="0.06" />
      <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#f3f1e6" stroke-opacity="0.96" stroke-width="3.5" filter="url(#ring-shadow)" />
      <circle cx="${center}" cy="${center}" r="${Math.max(radius - 18, 10)}" fill="none" stroke="#2f7f5a" stroke-opacity="0.82" stroke-width="1.75" stroke-dasharray="10 8" />
      <circle cx="${center}" cy="${center}" r="4.5" fill="#f3f1e6" />
      <rect x="${center - 58}" y="${center + radius + 20}" width="116" height="28" rx="4" fill="#0e1813" fill-opacity="0.72" />
      <text x="${center}" y="${center + radius + 39}" fill="#f3f1e6" font-family="Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="0.18em" text-anchor="middle">${label}</text>
    </svg>`,
  );
};

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
      debugSatellitePreview("tile-miss", { zoom, tileY, tileX, status: response.status, contentType });
      return null;
    }

    const payload = Buffer.from(await response.arrayBuffer());
    debugSatellitePreview("tile-hit", { zoom, tileY, tileX, bytes: payload.length });
    return payload.length > 0 ? payload : null;
  } catch {
    debugSatellitePreview("tile-error", { zoom, tileY, tileX });
    return null;
  }
};

const renderSatellitePreview = async (
  latitude: number,
  longitude: number,
  candidate: AddressCandidate,
  precision: SatellitePreviewPrecision,
) => {
  const zoom = getPrecisionZoom(candidate, precision);
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
    debugSatellitePreview("render-insufficient-tiles", {
      composites: composites.length,
      latitude,
      longitude,
      precision,
      zoom,
    });
    return null;
  }

  const baseComposite = await sharp({
    create: {
      background: "#dad5ca",
      channels: 3,
      height: satelliteImageSize,
      width: satelliteImageSize,
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return sharp(baseComposite)
    .modulate({ brightness: 1.02, saturation: 1.04 })
    .composite([{ input: buildPrecisionCircleOverlay(precision), left: 0, top: 0 }])
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
  debugSatellitePreview(opportunity.slug, "start");
  if (satellitePreviewMemoryCache.has(opportunity.slug)) {
    debugSatellitePreview(opportunity.slug, "memory-cache-hit");
    return satellitePreviewMemoryCache.get(opportunity.slug) ?? null;
  }

  const previewPath = getSatellitePreviewPath(opportunity.slug);
  if (existsSync(previewPath)) {
    try {
      const cachedPreview = await readFile(previewPath);
      if (await isInvalidSatellitePreviewBuffer(cachedPreview)) {
        debugSatellitePreview(opportunity.slug, "disk-cache-invalid");
        await rm(previewPath, { force: true });
      } else {
        debugSatellitePreview(opportunity.slug, "disk-cache-hit");
        satellitePreviewMemoryCache.set(opportunity.slug, cachedPreview);
        return cachedPreview;
      }
    } catch {
      // Fall through and attempt regeneration.
    }
  }

  const persistPreviewBuffer = async (previewBuffer: Buffer | null) => {
    if (!previewBuffer) {
      debugSatellitePreview(opportunity.slug, "persist-null");
      satellitePreviewMemoryCache.set(opportunity.slug, null);
      return null;
    }

    try {
      if (await isInvalidSatellitePreviewBuffer(previewBuffer)) {
        debugSatellitePreview(opportunity.slug, "persist-invalid-buffer", previewBuffer.length);
        satellitePreviewMemoryCache.set(opportunity.slug, null);
        return null;
      }

      debugSatellitePreview(opportunity.slug, "persist-buffer", previewBuffer.length);
      satellitePreviewMemoryCache.set(opportunity.slug, previewBuffer);
      await mkdir(previewImageDirectory, { recursive: true });
      await writeFile(previewPath, previewBuffer);
    } catch {
      // Disk cache is best-effort only.
    }

    return previewBuffer;
  };

  const tryRenderFromCandidates = async (candidates: AddressCandidate[]) => {
    debugSatellitePreview(opportunity.slug, "try-render-candidates", candidates.length);
    for (const candidate of candidates) {
      debugSatellitePreview(opportunity.slug, "candidate", candidate);
      const geocode = await geocodePreciseAddress(opportunity, candidate);
      if (!geocode) {
        debugSatellitePreview(opportunity.slug, "candidate-no-geocode", candidate.address);
        continue;
      }

      const previewBuffer = await renderSatellitePreview(
        geocode.lat,
        geocode.lng,
        candidate,
        geocode.precision,
      );
      if (previewBuffer) {
        debugSatellitePreview(opportunity.slug, "candidate-rendered", candidate.address, previewBuffer.length);
        return previewBuffer;
      }

      debugSatellitePreview(opportunity.slug, "candidate-render-null", candidate.address);
    }

    return null;
  };

  const titleCandidates = extractAddressCandidatesFromText(opportunity.title, "title");
  const localityCandidates = resolveOpportunityLocalityCandidates(opportunity);
  const titleHintLocalityCandidates = buildLocalityCandidatesFromAddressHints(titleCandidates);
  const titlePreview = await tryRenderFromCandidates(
    dedupeAddressCandidates([...titleCandidates, ...localityCandidates, ...titleHintLocalityCandidates]),
  );
  if (titlePreview) {
    debugSatellitePreview(opportunity.slug, "title-preview-hit");
    return persistPreviewBuffer(titlePreview);
  }

  const pageLocationSignals = await fetchOpportunityPageLocationSignals(opportunity);
  const pageSignalCandidates = dedupeAddressCandidates([
    ...pageLocationSignals.structuredCandidates,
    ...pageLocationSignals.textCandidates,
  ]);
  const pageHintLocalityCandidates = buildLocalityCandidatesFromAddressHints(pageSignalCandidates);
  const seenKeys = new Set(
    [...titleCandidates, ...localityCandidates, ...titleHintLocalityCandidates].map((candidate) =>
      getAddressCandidateComparisonKey(candidate),
    ),
  );
  const pageCandidates = pageSignalCandidates.filter(
    (candidate) => !seenKeys.has(getAddressCandidateComparisonKey(candidate)),
  );
  const pageLocalityCandidates = pageHintLocalityCandidates.filter(
    (candidate) => !seenKeys.has(getAddressCandidateComparisonKey(candidate)),
  );
  pageCandidates.forEach((candidate) => {
    seenKeys.add(getAddressCandidateComparisonKey(candidate));
  });
  pageLocalityCandidates.forEach((candidate) => {
    seenKeys.add(getAddressCandidateComparisonKey(candidate));
  });

  const previewBuffer = await tryRenderFromCandidates([...pageCandidates, ...pageLocalityCandidates]);
  if (previewBuffer) {
    debugSatellitePreview(opportunity.slug, "page-preview-hit");
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
    debugSatellitePreview(opportunity.slug, "no-preview");
    return persistPreviewBuffer(null);
  }

  debugSatellitePreview(opportunity.slug, "pdf-preview-hit");
  return persistPreviewBuffer(pdfPreview);
};

export const resolveOpportunitySatelliteLocator = async (
  opportunity: SatellitePreviewInput,
) => {
  const titleCandidates = extractAddressCandidatesFromText(opportunity.title, "title");
  const localityCandidates = resolveOpportunityLocalityCandidates(opportunity);

  for (const candidate of dedupeAddressCandidates([...titleCandidates, ...localityCandidates])) {
    const geocode = await geocodePreciseAddress(opportunity, candidate);
    if (geocode) {
      return {
        lat: geocode.lat,
        lng: geocode.lng,
        locationLabel: candidate.localityHint ?? candidate.address,
        precision: geocode.precision,
      };
    }
  }

  const pageLocationSignals = await fetchOpportunityPageLocationSignals(opportunity);
  const pageCandidates = dedupeAddressCandidates([
    ...pageLocationSignals.structuredCandidates,
    ...pageLocationSignals.textCandidates,
  ]);

  for (const candidate of pageCandidates) {
    const geocode = await geocodePreciseAddress(opportunity, candidate);
    if (geocode) {
      return {
        lat: geocode.lat,
        lng: geocode.lng,
        locationLabel: candidate.localityHint ?? candidate.address,
        precision: geocode.precision,
      };
    }
  }

  const pdfCandidates = await extractAddressCandidatesFromPdfUrls(
    pageLocationSignals.pdfCandidates.map((candidate) => candidate.url),
  );
  for (const candidate of pdfCandidates) {
    const geocode = await geocodePreciseAddress(opportunity, candidate);
    if (geocode) {
      return {
        lat: geocode.lat,
        lng: geocode.lng,
        locationLabel: candidate.localityHint ?? candidate.address,
        precision: geocode.precision,
      };
    }
  }

  return null;
};

export const satellitePreviewContentType = imageContentType;
export const satellitePreviewTestUtils = {
  bd09ToWgs84,
  buildBaiduSignedUrl,
  calculateBoundingBoxDiagonalKm,
  buildGeocodeQueries,
  expandAddressVariantsForGeocoder,
  gcj02ToWgs84,
  isAcceptableGeocodeResult,
  isAcceptableAmapGeocodeResult,
  isAcceptableBaiduGeocodeResult,
  isInvalidSatellitePreviewBuffer,
  expandLocalityVariantsForGeocoder,
  extractAddressCandidatesFromText,
  extractAddressCandidatesFromPdfText,
  extractPdfUrlsFromHtml,
  extractStructuredAddressCandidatesFromHtml,
  resolveChineseGeocodePrecision,
  resolveGeocodePrecision,
  resolveGeocodeQueries,
  stripHtmlToText,
};
