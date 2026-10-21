// Regular-expression building blocks used by address extraction.
import type { AddressCandidateKind } from "../types";

export const combiningDiacriticPattern = /[\u0300-\u036f]/g;

export const streetNumberBodyPattern = String.raw`\d[\p{L}\p{N}]*(?:\s*(?:[-/]\s*)\d[\p{L}\p{N}]*){0,2}`;

export const streetNumberPattern = new RegExp(
  String.raw`\b(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)?${streetNumberBodyPattern}\b`,
  "iu",
);

export const addressPrefixPattern = String.raw`(?:c\/|c\.|via|viale|piazza|piazzale|corso|largo|vicolo|lungomare|strada|street|road|drive|lane|way|boulevard|avenue|avenues|avenida|avda\.?|av\.|rue|route|chemin|all[eé]e|allee|impasse|quai|parvis|esplanade|gasse|platz|strasse|straße|calle|camino|carretera|ruta|plaza|paseo|ronda|rua|travessa|estrada|pra[çc]a|cal[çc]ada|rotunda|marginal|laan|plein|gracht|kade|singel|dreef|steiger|ul\.?|ulica|ulice|aleja|al\.|bd\.?|bulevard(?:ul)?|bulvar|bulevar|str\.?|calea|sos\.?|șos\.?|ул\.?)`;

export const addressBodyPattern = String.raw`[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,7}`;

export const localityPrefixPattern =
  String.raw`(?:località|localita|barrio|bairro|quartiere|frazione|hamlet|village|neighbourhood|neighborhood|suburb|district|distrito|urbanizaci[oó]n|freguesia|wijk|stadsdeel|bydel|campus)`;

export const placeNamePattern = String.raw`[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,5}`;

export const localityWrapperStripPattern =
  /^(?:barrio|bairro|quartiere|frazione|hamlet|village|neighbourhood|neighborhood|suburb|district|distrito|urbanizaci[oó]n|freguesia|wijk|stadsdeel|bydel|quartier|lotissement|urbanizzazione|resid[eé]nce|residenza)\s+/iu;

export const sitePrefixPattern = String.raw`(?:campus)`;

export const siteBodyPattern = String.raw`[\p{L}\p{N}.'’/-]+(?:\s+(?:di|de|del|de la|de los|of)\s+)?(?:[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,5})`;

export const dashDelimitedLocalityTokenPattern = String.raw`[\p{L}\p{N}.'’/]+(?:-[\p{L}\p{N}.'’/]+)*`;

export const titleSitePrefixPattern =
  String.raw`(?:campus|quartier|quartiers|lotissement|urbanizaci[oó]n|urbanizzazione|resid[eé]nce|residenza|parque(?:\s+empresarial)?|parco|groupe\s+scolaire|[eé]cole|coll[eè]ge|lyc[eé]e|gymnase|mus[eé]e|palais|complexe|centre\s+d['’]intervention|zac|zap|zone\s+d['’](?:am[eé]nagement|activit[eé]s?)|site(?:\s+pilote)?|[iî]lot|ilot|secteur|sous-secteur|lieu-dit)`;

export const frenchDashDelimitedSiteLeadPattern = new RegExp(
  String.raw`\b(${dashDelimitedLocalityTokenPattern}(?:\s+${dashDelimitedLocalityTokenPattern}){0,4})\s*[-–—]\s+((?:${addressPrefixPattern}|${titleSitePrefixPattern})\s+[\p{L}\p{N}"«»'’/-]+(?:\s+[\p{L}\p{N}"«»'’/-]+){0,8})`,
  "giu",
);

export const frenchQuotedSiteLeadPattern = new RegExp(
  String.raw`\b(${dashDelimitedLocalityTokenPattern}(?:\s+${dashDelimitedLocalityTokenPattern}){0,4})\s*[«"]\s*((?:${titleSitePrefixPattern})\s+[\p{L}\p{N}"'’/-]+(?:\s+[\p{L}\p{N}"'’/-]+){0,8})\s*[»"]`,
  "giu",
);

export const chineseInstitutionCampusPattern =
  /((?:[\p{Script=Han}]{2,20}(?:大学|学院|学校|中学|医院))[\p{Script=Han}\p{L}\p{N}-]{0,20}?(?:校区|院区))/gu;

export const chineseRoadInsideSitePattern =
  /([\p{Script=Han}]{1,8}(?:路|街|道))(?=(?:校区|院区|片区|小区))/u;

export const chineseShortSiteAnchorPattern =
  /((?:[\p{Script=Han}\p{L}\p{N}-]{2,24}(?:片区|片小区|街区))|(?:[\p{Script=Han}\p{L}\p{N}-]{2,24}小区))(?:老旧(?:小区|街区)|改造工程|改造项目|修复改造|建设项目)?/u;

export const chineseStreetAsLocalityPattern =
  /(?:^|\d{4}年|[^\p{Script=Han}])((?:[\p{Script=Han}]{1,12}(?:市|区|县)){0,3}[\p{Script=Han}]{1,12}街道)(?=[\p{Script=Han}\p{L}\p{N}-]{0,24}(?:老旧小区|改造工程|改造项目|建设项目))/u;

export const chineseAdministrativeSitePattern =
  /(?:^|\d{4}年|[^\p{Script=Han}])((?:[\p{Script=Han}]{1,12}(?:市|区|县)){0,2}[\p{Script=Han}]{1,12}(?:街道|镇|乡)[\p{Script=Han}\p{L}\p{N}-]{0,16}(?:老旧小区|小区|片区|街区))/u;

export const chineseAdministrativeUnitPattern = String.raw`(?:[\p{Script=Han}]{1,12}(?:省|市|县|镇|乡|街道|新区|开发区|自治州|自治县)|[\p{Script=Han}]{1,12}(?<!街)(?<!院)(?<!校)(?<!园)(?<!片)(?<!社)(?<!小)区)`;

export const chineseCompoundPlacePattern =
  String.raw`[\p{Script=Han}\p{L}\p{N}-]{1,40}(?:校区|院区|园区|片区|街区|地块|小区|社区|村\d+号|村|广场|公园|基地)`;

export const chineseRoadPattern =
  String.raw`[\p{Script=Han}\p{L}\p{N}-]{1,30}(?:路|街(?!区)|道|巷|胡同|正街|大道)`;

export const chineseDirectionalRoadPattern =
  String.raw`(${chineseRoadPattern})(?=\s*(?:以东|以西|以南|以北))`;

export const chinesePreciseSiteFieldPattern = new RegExp(
  String.raw`(?:建设地点|工程地点|项目地点|实施地点)[：:]\s*((?:(?:${chineseAdministrativeUnitPattern}){0,4})[\p{Script=Han}\p{L}\p{N}-]{1,48}(?:校区|院区|园区|片区|街区|地块|小区|社区|村\d+号|村|广场|公园|基地|院内|院区内|校区内))`,
  "gu",
);

export const chinesePreciseStreetFieldPattern = new RegExp(
  String.raw`(?:建设地点|工程地点|项目地点|实施地点)[：:]\s*((?:(?:(?:${chineseAdministrativeUnitPattern}){0,4})\s*)?${chineseRoadPattern}(?:\s*\d+\s*号)?)`,
  "gu",
);

export const trailingStreetTypePattern =
  String.raw`(?:straat|laan|plein|gracht|kade|singel|dreef|gade|gata|gatan|gate|torv|torget|plass|plassen|vei|veien|veg|vegen|v[aä]g|v[aä]gen|weg|ring|damm|ufer|allee|pfad|stieg|steig|tie|katu|kuja|polku|cesta|strasse|straße|ulica|n[aá]m[ěe]st[ií]|trg|utca)`;

export const compoundTrailingStreetWordPattern =
  String.raw`[\p{L}\p{N}.'’/-]+${trailingStreetTypePattern}`;

export const multiWordCompoundTrailingStreetPattern =
  String.raw`[\p{L}\p{N}.'’/-]+\s+[\p{L}\p{N}.'’/-]+${trailingStreetTypePattern}`;

export const spacedTrailingStreetPattern =
  String.raw`[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,4}\s+${trailingStreetTypePattern}`;

export const trailingStreetAddressPattern = String.raw`(?:${multiWordCompoundTrailingStreetPattern}|${spacedTrailingStreetPattern}|${compoundTrailingStreetWordPattern})`;

export const titleStreetTailBoundaryPattern = String.raw`(?=(?:\s*[-–—]\s+)|(?:\s*,\s*(?:${localityPrefixPattern}\s+${placeNamePattern}|${placeNamePattern}(?:\s*\((?:[A-Z]{2}|\d{2,5})\))?))|(?:\s+(?:à|au|aux|sur|sous|l[eè]s|en|em|w|v|u|im|am|bei|auf|nel|nella|in|na|no|te|i)\s+${placeNamePattern}(?:\s*\((?:[A-Z]{2}|\d{2,5})\))?)|(?:\s*\([A-Z0-9-]{2,}\))|[.;,)]|$)`;

export const titleSiteTailBoundaryPattern = String.raw`(?=(?:\s*[-–—]\s+)|(?:\s*,\s*(?:${placeNamePattern}(?:\s*\((?:[A-Z]{2}|\d{2,5})\))?))|(?:\s+(?:à|au|aux|sur|sous|l[eè]s|en|em|w|v|u|im|am|bei|auf|nel|nella|in|na|no|te|i)\s+${placeNamePattern}(?:\s*\((?:[A-Z]{2}|\d{2,5})\))?)|[.;,)]|$)`;

export const numberLeadingStreetAddressPattern = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:\d+(?:\s+(?:bis|ter|quater))?|${streetNumberBodyPattern})\s+${addressPrefixPattern}\s+${addressBodyPattern}${titleStreetTailBoundaryPattern}`,
  "giu",
);

export const titleAddressCandidatePatterns: Array<{ kind: AddressCandidateKind; pattern: RegExp }> = [
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

export const compoundAddressPattern = new RegExp(
  String.raw`^(${addressPrefixPattern}\s+${addressBodyPattern})\s+(?:con|with)\s+(${addressPrefixPattern}\s+${addressBodyPattern})$`,
  "iu",
);

export const referencedAddressPattern = new RegExp(
  String.raw`\b(?:a|to|towards|verso)\s+(${addressPrefixPattern}\s+${addressBodyPattern})$`,
  "iu",
);

export const streetPrefixForGeocoderStripPattern = new RegExp(
  String.raw`^(?:c\/|c\.|via|viale|piazza|piazzale|corso|largo|vicolo|lungomare|strada|street|road|drive|lane|way|boulevard|avenue|avenida|avda\.?|av\.|rue|route|allee|gasse|platz|strasse|straße|calle|camino|carretera|ruta|plaza|paseo|ronda|rua|travessa|estrada|pra[çc]a|cal[çc]ada|rotunda|marginal|laan|plein|gracht|kade|singel|dreef|steiger|ul\.?|ulica|ulice|aleja|al\.|bd\.?|bulevard(?:ul)?|bulvar|bulevar|str\.?|calea|sos\.?|șos\.?|ул\.?)\s+`,
  "iu",
);

export const addressCandidatePatterns: Array<{ kind: AddressCandidateKind; pattern: RegExp }> = [
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

export const rejectedAddressMarkers =
  /\b(?:cup|cig|codice|missione|lotto|pnrr|investimento|procedura|intervento|progetto|servizio|lavori|adeguamento|bando|pratica)\b/iu;

export const rejectedAddressCandidatePattern =
  /^(?:al|c\.?\s*\d+|art\.?\s*\d+|co\.?\s*\d+|comma\s+\d+|lett\.?\s*[a-z]|strasse\s+\d[\p{L}\p{N}/-]*|straße\s+\d[\p{L}\p{N}/-]*)$/iu;

export const rejectedProceduralAddressPattern =
  /\b(?:coordinatore\s+per\s+la\s+sicurezza|patrimonio\s+del\s+comune|direzione\s+lavori|servizi?\s+tecnici|servizi?\s+di\s+ingegneria|affidamento|progettazione|redazione|fachplanung|projektsteuerung|obras|contrataci[oó]n|concesi[oó]n|servicios?\s+de|lavori\s+di)\b/iu;

export const rejectedLocalityMarkers =
  /\b(?:esta localidad|questa località|this locality|questo comune|distrito suroeste de esta localidad)\b/iu;

export const rejectedBroadChineseLocalityPattern = /(?:省|自治区|特别行政区)$/u;

export const multiLocalityConnectorPattern =
  /\b(?:and|et|y|e)\b|(?:ayuntamientos\s+de)|(?:captages?\s+de)|(?:,\s*[\p{L}\p{Script=Han}]{2,}){2,}/iu;

export const trailingAddressFieldStopPattern =
  /\s+(?:projektnummer|quartier|grundst[üu]cksnummer|wirtschaftseinheit|baujahr|bautyp|bgf|bestand|potenzial|objekt(?:daten)?|adresse|flurst[üu]ck|flurst[üu]cksnummer|bezirk|plan(?:nummer|-nummer|nr)?|maßstab|datum|leistungsumfang|dates?\s+and\s+deadlines|period|expiration(?:\s+time)?|seite)\s*[:=-]?[\s\S]*$/iu;

export const localityTailNoisePattern =
  /\b(?:projektnummer|quartier|grundst[üu]cksnummer|wirtschaftseinheit|baujahr|bautyp|bgf|bestand|potenzial|objekt(?:daten)?|adresse|flurst[üu]ck|flurst[üu]cksnummer|plan(?:nummer|-nummer|nr)?|maßstab|datum|leistungsumfang|period|expiration|seite)\b/iu;

export const preservedChineseAdministrativeSitePattern =
  /(?:[\p{Script=Han}]{1,12}(?:市|区|县)){0,2}[\p{Script=Han}]{1,12}(?:街道|镇|乡)[\p{Script=Han}\p{L}\p{N}-]{0,16}(?:老旧小区|小区|片区|街区)$/u;

export const genericChineseRegenerationSitePattern = /^老旧(?:小区|街区)$/u;

export const chineseAddressNoiseLeadPattern =
  /^(?:本招标项目|本项目|项目业主|招标人为|招标代理机构为|发改委关于|省发改委关于|对(?:产业基地|项目|地块)?|主要建设内容为)/u;

export const chineseLocalityNoiseLeadPattern =
  /^(?:招标代理机构为|项目业主|招标人为|本工程场地位于|本项目位于|本项目建设地点为|本项目建设地点位于)/u;

export const chineseFacilityCorePattern =
  /((?:[\p{Script=Han}]{2,24}(?:大学|学院|学校|中学|小学|医院|人民医院|第一中学|第二中学|第三中学))(?:[\p{Script=Han}\p{L}\p{N}-]{0,20}?(?:校区|院区))?)/u;

export const chineseRoadWithNumberPattern =
  /([\p{Script=Han}\p{L}\p{N}-]{1,30}(?:路|街(?!区)|道|巷|胡同|正街|大道)\s*\d+\s*号)/u;

export const chineseRoadOnlyPattern =
  /([\p{Script=Han}\p{L}\p{N}-]{1,30}(?:路|街(?!区)|道|巷|胡同|正街|大道))/u;

export const chineseInstitutionSiteTailPattern =
  /((?:[\p{Script=Han}]{2,24}(?:大学|学院|学校|中学|小学|医院))[\p{Script=Han}\p{L}\p{N}-]{0,24}?(?:校区|院区|新校区))/u;

export const chineseWeakSiteNoisePattern =
  /^(?:拟规划建设中试基地|创新创业基地|实验实训基地|主要建设内容为小区|弱电设计需接驳到校区)$/u;

export const chineseDirectionalSuffixPattern = /(?:内|院内|校区内|校园内|北侧|南侧|东侧|西侧|及其周边区域|及其周边区|周边区域)$/u;
