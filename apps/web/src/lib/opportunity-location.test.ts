import assert from "node:assert/strict";
import test from "node:test";

import {
  pickOpportunityDisplayLocality,
  pickOpportunityExplicitCity,
  sanitizeOpportunityLocationLabel,
} from "./opportunity-location.ts";

test("pickOpportunityExplicitCity rejects street-address tails that are not cities", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "Alcaldía del Ayuntamiento de Emperador",
    jurisdictionKey: "spain",
    jurisdictionLabel: "Spain",
    title:
      'Obra de ejecución de rehabilitación y cambio de uso de edifcio para "Llar del Jubilat" de Emperador, en Avenida Barcelona nº 18',
  });

  assert.equal(city, "Emperador");
});

test("pickOpportunityExplicitCity reads portuguese municipality authority names", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "Município do Porto",
    jurisdictionKey: "portugal",
    jurisdictionLabel: "Portugal",
    title: "Empreitada de reabilitação da Rua das Flores 12",
  });

  assert.equal(city, "Porto");
});

test("pickOpportunityExplicitCity reads dutch municipal authority names", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "Gemeente Amsterdam",
    jurisdictionKey: "netherlands",
    jurisdictionLabel: "Netherlands",
    title: "Renovatie van het pand aan Kerkstraat 12",
  });

  assert.equal(city, "Amsterdam");
});

test("pickOpportunityExplicitCity reads nordic trailing municipal authority names", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "Oslo kommune",
    jurisdictionKey: "norway",
    jurisdictionLabel: "Norway",
    title: "Utarbeidelse av reguleringsplan, Økern Torgvei 2",
  });

  assert.equal(city, "Oslo");
});

test("pickOpportunityExplicitCity reads finnish trailing municipal authority names", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "Helsingin kaupunki",
    jurisdictionKey: "finland",
    jurisdictionLabel: "Finland",
    title: "Peruskorjaus, Heka Ylä-Malmi Markkinatie 16",
  });

  assert.equal(city, "Helsingin");
});

test("pickOpportunityExplicitCity reads central european trailing municipal authority names", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "Suwałki miasto",
    jurisdictionKey: "poland",
    jurisdictionLabel: "Poland",
    title: "Opracowanie dokumentacji projektowej przy ul. Noniewicza 31 w Suwałkach",
  });

  assert.equal(city, "Suwałki");
});

test("pickOpportunityExplicitCity reads nordic municipal authorities followed by department tails", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "Oslo kommune v/ Eiendoms- og byfornyelsesetaten",
    jurisdictionKey: "norway",
    jurisdictionLabel: "Norway",
    title: "Utarbeidelse av reguleringsplan, Økern Torgvei 2",
  });

  assert.equal(city, "Oslo");
});

test("pickOpportunityExplicitCity reads central european municipal prefixes", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "Gmina Miasto Suwałki",
    jurisdictionKey: "poland",
    jurisdictionLabel: "Poland",
    title:
      "Opracowanie dokumentacji projektowej na wykonanie wewnętrznej instalacji c.o. i c.w.u. przy ul. Noniewicza 31 w Suwałkach",
  });

  assert.equal(city, "Suwałki");
});

test("pickOpportunityExplicitCity ignores lowercase descriptive tails after comma-separated addresses", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "MINISTRSTVO ZA JAVNO UPRAVO",
    jurisdictionKey: "slovenia",
    jurisdictionLabel: "Slovenia",
    title:
      "Izdelava projektne dokumentacije za preureditev objekta na naslovu Prešernova cesta 11, Radovljica, z upoštevanjem okoljskih vidikov",
  });

  assert.equal(city, "Radovljica");
});

test("pickOpportunityExplicitCity still prefers authority-derived city when title embeds a square locality tail", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "Comune di Monte Argentario",
    jurisdictionKey: "italy",
    jurisdictionLabel: "Italy",
    title:
      "AFFIDAMENTO SERVIZI DI PROGETTAZIONE DI FATTIBILITA’ TECNICO ECONOMICA RELATIVA ALLA REALIZZAZIONE DI UNA NUOVA ROTATORIA PER LA RIORGANIZZAZIONE DELLA VIABILITA’ IN PIAZZA AMERIGO VESPUCCI IN PORTO ERCOLE",
  });

  assert.equal(city, "Monte Argentario");
});

test("pickOpportunityExplicitCity still prefers authority-derived cities when title tails are noisy", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "Oslo kommune",
    jurisdictionKey: "norway",
    jurisdictionLabel: "Norway",
    title: "2025/5060 Parallelle rammeavtaler om rådgivende arkitekttjenester (ARK, LARK og IARK)",
  });

  assert.equal(city, "Oslo");
});

test("sanitizeOpportunityLocationLabel drops procedural location noise", () => {
  assert.equal(sanitizeOpportunityLocationLabel("Investimento 3.3"), null);
  assert.equal(sanitizeOpportunityLocationLabel("DIREZIONE LAVORI E CONTABILITA'"), null);
});

test("sanitizeOpportunityLocationLabel keeps real city labels and trims authority prefixes", () => {
  assert.equal(
    sanitizeOpportunityLocationLabel("Kulttuurin ja vapaa-ajan toimiala, Helsingin"),
    "Helsingin",
  );
  assert.equal(sanitizeOpportunityLocationLabel("Ottawa"), "Ottawa");
});

test("sanitizeOpportunityLocationLabel rejects urls, institutions, and province-scale labels", () => {
  assert.equal(sanitizeOpportunityLocationLabel("sul sito weArch.eu"), null);
  assert.equal(sanitizeOpportunityLocationLabel("Bell Block Primary School"), null);
  assert.equal(sanitizeOpportunityLocationLabel("广东省"), null);
});

test("pickOpportunityDisplayLocality prefers explicit city over noisy location labels", () => {
  const locality = pickOpportunityDisplayLocality({
    authorityName: "Comune di Mirano",
    jurisdictionKey: "italy",
    jurisdictionLabel: "Italy",
    locationLabel: "Milano",
    title:
      "SERVIZIO PROFESSIONALE DI INGEGNERIA ED ARCHITETTURA RELATIVO AI LAVORI DI ASFALTATURA E MESSA IN SICUREZZA DI VARIE VIE DEL COMUNE DI MIRANO (VE).",
  });

  assert.equal(locality, "Mirano");
});

test("pickOpportunityExplicitCity reads italian provincial authority names", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "PROVINCIA DI RIMINI",
    jurisdictionKey: "italy",
    jurisdictionLabel: "Italy",
    title:
      "INCARICO PER L'ASSOLVIMENTO DEGLI OBBLIGHI PREVISTI DAL D. LGS. 81/2008 IN CAPO AL COORDINATORE",
  });

  assert.equal(city, "RIMINI");
});

test("pickOpportunityExplicitCity reads chinese administrative title leads when location labels stay provincial", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "National Public Resources Trading Platform",
    jurisdictionKey: "china",
    jurisdictionLabel: "China",
    title: "黄山市徽州区2026年老旧小区改造-黄山路片小区改造工程项目-一标段-公开招标公告",
  });

  assert.equal(city, "黄山市徽州区");
});

test("pickOpportunityExplicitCity does not treat chinese site-scale title tails as explicit cities", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "National Public Resources Trading Platform",
    jurisdictionKey: "china",
    jurisdictionLabel: "China",
    title: "三江新区大学城片区03街区011地块M0产业园区建设项目建筑方案及施工图设计招标公告",
  });

  assert.equal(city, null);
});

test("pickOpportunityExplicitCity reads dash-delimited french locality before site/address tails", () => {
  const city = pickOpportunityExplicitCity({
    authorityName: "NANTES MÉTROPOLE HABITAT",
    jurisdictionKey: "france",
    jurisdictionLabel: "France",
    title:
      "France – Architectural and related services – SAINT HERBLAIN - Chemin de la Solvadière - Mission de maîtrise d'oeuvre pour la construction d'environ 18 logements individuels groupés",
  });

  assert.equal(city, "SAINT HERBLAIN");
});
