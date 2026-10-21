import assert from "node:assert/strict";
import test from "node:test";

import { extractAddressCandidatesFromText } from "./extract";

test("extractAddressCandidatesFromText recognizes chinese engineering-place fields with street addresses and villages", () => {
  const candidates = extractAddressCandidatesFromText(
    "工程地点：景泰县一条山镇705路北街6号、景泰县一条山镇杏林村。",
    "page",
  );

  assert.deepEqual(candidates, [
    {
      address: "705路北街6号",
      kind: "street_address",
      localityHint: "景泰县一条山镇",
      source: "page",
    },
    {
      address: "杏林村",
      kind: "site",
      localityHint: "景泰县一条山镇",
      source: "page",
    },
  ]);
});

test("extractAddressCandidatesFromText keeps chinese street numbers when township and road are separated by spaces", () => {
  const candidates = extractAddressCandidatesFromText(
    "工程地点：景泰县一条山镇 705路北街6号、景泰县一条山镇杏林村。",
    "page",
  );

  assert.deepEqual(candidates, [
    {
      address: "705路北街6号",
      kind: "street_address",
      localityHint: "景泰县一条山镇",
      source: "page",
    },
    {
      address: "杏林村",
      kind: "site",
      localityHint: "景泰县一条山镇",
      source: "page",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes chinese directional road boundaries phrased as road east-west", () => {
  const candidates = extractAddressCandidatesFromText(
    "建设地点：四川省宜宾市三江新区大学城片区03街区，鸿儒路以东，大学路以西。",
    "page",
  );

  assert.deepEqual(candidates, [
    {
      address: "大学城片区03街区",
      kind: "site",
      localityHint: "四川省宜宾市三江新区",
      source: "page",
    },
    {
      address: "鸿儒路",
      kind: "street",
      localityHint: "四川省宜宾市三江新区",
      source: "page",
    },
    {
      address: "大学路",
      kind: "street",
      localityHint: "四川省宜宾市三江新区",
      source: "page",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes chinese village-number project names as site candidates", () => {
  const candidates = extractAddressCandidatesFromText(
    "石景山区黄庄村43号棚户区改造项目SS00-1622-002、SS00-2501-002地块项目（方案设计、初步设计、施工图设计）招标公告",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "黄庄村43号",
      kind: "site",
      localityHint: "石景山区",
      source: "title",
    },
    {
      address: "SS00-2501-002地块",
      kind: "site",
      localityHint: "石景山区",
      source: "title",
    },
    {
      address: "SS00-1622-002地块",
      kind: "site",
      localityHint: "石景山区",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes chinese campus and hospital compounds in titles", () => {
  const candidates = extractAddressCandidatesFromText(
    "南充市中医医院金鱼岭院区病房改造提升项目施工图设计。建设地点：南充市顺庆区金鱼岭正街。",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "金鱼岭正街",
      kind: "street",
      localityHint: "南充市顺庆区",
      source: "title",
    },
    {
      address: "金鱼岭院区",
      kind: "site",
      localityHint: "南充市顺庆区",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText trims chinese procedural lead-ins from page site candidates", () => {
  const candidates = extractAddressCandidatesFromText(
    "建设地点：黄冈市城东临空经济区黄冈师范学院东校区内。本招标项目黄冈师范学院东校区学生宿舍A、B栋项目。",
    "page",
  );

  assert.deepEqual(candidates, [
    {
      address: "黄冈师范学院东校区",
      kind: "site",
      localityHint: "黄冈市城东临空经济区",
      source: "page",
    },
  ]);
});

test("extractAddressCandidatesFromText filters chinese facility-description noise from page text", () => {
  const candidates = extractAddressCandidatesFromText(
    "建设地点：四川省宜宾市三江新区大学城片区03街区，拟规划建设中试基地、创新创业基地、实验实训基地，鸿儒路以东，大学路以西。",
    "page",
  );

  assert.deepEqual(candidates, [
    {
      address: "大学城片区03街区",
      kind: "site",
      localityHint: "四川省宜宾市三江新区",
      source: "page",
    },
    {
      address: "鸿儒路",
      kind: "street",
      localityHint: "四川省宜宾市三江新区",
      source: "page",
    },
    {
      address: "大学路",
      kind: "street",
      localityHint: "四川省宜宾市三江新区",
      source: "page",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes french dash-delimited city and chemin titles", () => {
  const candidates = extractAddressCandidatesFromText(
    "France – Architectural and related services – SAINT HERBLAIN - Chemin de la Solvadière - Mission de maîtrise d'oeuvre pour la construction d'environ 18 logements individuels groupés",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Chemin de la Solvadière",
      kind: "street",
      localityHint: "SAINT HERBLAIN",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes french ZAC ilot site titles", () => {
  const candidates = extractAddressCandidatesFromText(
    "France – Architectural and related services – MORDELLES « ZAC VAL DE SERMON Ilot B » – Maîtrise d'œuvre pour la construction de 30 logements – N° OP000501",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "ZAC VAL DE SERMON Ilot B",
      kind: "site",
      localityHint: "MORDELLES",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes french public-facility site titles with locality tails", () => {
  const candidates = extractAddressCandidatesFromText(
    "MISSION D'ASSISTANCE A MAITRISE D'OUVRAGE RELATIVE A LA RESTRUCTURATION LOURDE ET LA RENOVATION ENERGETIQUE DU COLLÈGE LES 4 VENTS AU LUDE (72800)",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "COLLÈGE LES 4 VENTS",
      kind: "site",
      localityHint: "LUDE",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText keeps full chinese institution campus names and embedded road aliases", () => {
  const candidates = extractAddressCandidatesFromText(
    "云南财经大学龙泉路校区学生宿舍及附属用房建设项目方案设计及初步设计招标公告",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "云南财经大学龙泉路校区",
      kind: "site",
      localityHint: "云南财经大学龙泉路校区",
      source: "title",
    },
    {
      address: "龙泉路",
      kind: "street",
      localityHint: "云南财经大学龙泉路校区",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText trims chinese locality-scale site anchors instead of swallowing project tails", () => {
  const candidates = extractAddressCandidatesFromText(
    "遂川县恒福庄园片区2026年老旧小区改造项目设计服务",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "恒福庄园片区",
      kind: "site",
      localityHint: "遂川县",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText treats chinese subdistrict streetdao names as locality candidates in regeneration titles", () => {
  const candidates = extractAddressCandidatesFromText(
    "2026年东西湖区径河街道老旧小区改造工程勘察（测量）、初步设计（第一标段）",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "东西湖区径河街道老旧小区",
      kind: "site",
      localityHint: "东西湖区径河街道",
      source: "title",
    },
    {
      address: "东西湖区径河街道",
      kind: "locality",
      localityHint: "东西湖区径河街道",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes bare german street names in titles", () => {
  const candidates = extractAddressCandidatesFromText(
    "Julius-Ludowieg Straße - Projektsteuerung in Anlehnung an §§ 2+3 AHO Heft Nr. 9",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Julius-Ludowieg Straße",
      kind: "street",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes title streets before lot tails", () => {
  const candidates = extractAddressCandidatesFromText(
    "Nuovo impianto sportivo di Paperino, Via Lille – Lotto di completamento",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Via Lille",
      kind: "street",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes french street titles with dash-separated context", () => {
  const candidates = extractAddressCandidatesFromText(
    "Rennes - Rue Papu - Construction d'une passerelle piétons/cycles de franchissement de l'Ille",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Rue Papu",
      kind: "street",
      localityHint: "Rennes",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes title site wrappers beyond campus", () => {
  const candidates = extractAddressCandidatesFromText(
    "Adecuación de Pavimentación de Aceras en Urbanización Prado Cerrado",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Urbanización Prado Cerrado",
      kind: "site",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes campus titles with trailing locality", () => {
  const candidates = extractAddressCandidatesFromText(
    "Marché de maîtrise d'œuvre pour la rénovation des espaces extérieurs du Campus Ferry-Cormier à Coulommiers (77131)",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Campus Ferry-Cormier",
      kind: "site",
      localityHint: "Coulommiers",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText keeps project street address and filters plan contact addresses from pdf-like page text", () => {
  const candidates = extractAddressCandidatesFromText(
    "PROJEKT Prellerweg 47 - 49 12157 Berlin BAUHERR Grün Berlin GmbH Ullsteinhaus Mariendorfer Damm 1 12099 Berlin ARCHITEKT Brenne Architekten Rheinstraße 45 12161 Berlin PLAN-NUMMER LOK_BA_AA_A-SK-0806_Lageplan BA1-4 Maßstab 1:500",
    "page",
  );

  assert.deepEqual(candidates, [
    {
      address: "Prellerweg 47 - 49",
      kind: "street_address",
      localityHint: null,
      source: "page",
    },
  ]);
});

test("extractAddressCandidatesFromText filters bare straße spillover from portal metadata", () => {
  const candidates = extractAddressCandidatesFromText(
    "Action Straße 5 Dates and deadlines Period Expiration time Jun 8",
    "page",
  );

  assert.deepEqual(candidates, []);
});

test("extractAddressCandidatesFromText rejects procedural address noise from titles", () => {
  const candidates = extractAddressCandidatesFromText(
    "INCARICO PER L'ASSOLVIMENTO DEGLI OBBLIGHI PREVISTI DAL D. LGS. 81/2008 IN CAPO AL COORDINATORE PER LA SICUREZZA IN FASE DI PROGETTAZIONE E DI ESECUZIONE",
    "title",
  );

  assert.deepEqual(candidates, []);
});

test("extractAddressCandidatesFromText trims german functional prefixes before bare street titles", () => {
  const candidates = extractAddressCandidatesFromText(
    "Fachplanung Werkraum Schule Siegburger Straße (DUS-2026-0332)",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Siegburger Straße",
      kind: "street",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText trims italian locality tails embedded in square names", () => {
  const candidates = extractAddressCandidatesFromText(
    "AFFIDAMENTO SERVIZI DI PROGETTAZIONE DI FATTIBILITA’ TECNICO ECONOMICA RELATIVA ALLA REALIZZAZIONE DI UNA NUOVA ROTATORIA PER LA RIORGANIZZAZIONE DELLA VIABILITA’ IN PIAZZA AMERIGO VESPUCCI IN PORTO ERCOLE",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "PIAZZA AMERIGO VESPUCCI",
      kind: "street",
      localityHint: "PORTO ERCOLE",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText filters italian procedural page spillover tails", () => {
  const candidates = extractAddressCandidatesFromText(
    "accordo quadro per servizi tecnici di ingegneria architettura e geologia per gli interventi relativi al patrimonio del comune di montale pfte per la realizzazione di un nuovo parcheggio a tobbiana montale pt al massimo 200 caratteri Indietro Avanti Grazie",
    "page",
  );

  assert.deepEqual(candidates, []);
});
