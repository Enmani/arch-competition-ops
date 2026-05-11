import assert from "node:assert/strict";
import test from "node:test";

import { pickOpportunityExplicitCity } from "./opportunity-location.ts";

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
