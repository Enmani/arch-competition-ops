import assert from "node:assert/strict";
import test from "node:test";

import { getCountryEntry, getCountryName, isGenericJurisdiction, resolveOpportunityCountry } from "./countries";

const resolve = (locationLabel: string | null, title: string | null = null, jurisdictionKey: string | null = "eu") =>
  resolveOpportunityCountry({ jurisdictionKey, locationLabel, title });

test("the registry covers countries the product does not target, with names in several languages", () => {
  assert.equal(getCountryEntry("uganda")?.iso2, "UG");
  assert.equal(getCountryEntry("cote_d_ivoire")?.iso3, "CIV");
  assert.equal(getCountryName("uganda", "zh"), "乌干达");
  assert.equal(getCountryName("turkiye", "en"), "Türkiye");
  assert.equal(getCountryEntry("germany")?.iso2, "DE", "no deprecated East Germany code");
  assert.equal(getCountryEntry("atlantis"), null);
  assert.ok(isGenericJurisdiction("EU") && isGenericJurisdiction("global") && isGenericJurisdiction(null));
  assert.ok(!isGenericJurisdiction("germany"));
});

test("a real country in the jurisdiction wins over anything the text says", () => {
  assert.equal(resolve("Côte d'Ivoire", "France – Survey", "germany"), "germany");
  assert.equal(resolve(null, null, "united-kingdom"), "united_kingdom");
});

test("a generic jurisdiction is resolved from the place the record names", () => {
  assert.equal(resolve("Côte d'Ivoire", "France – Survey services"), "cote_d_ivoire");
  assert.equal(resolve("à Nouakchott, en Mauritanie"), "mauritania");
  assert.equal(resolve("Kampala, Uganda", null, "global"), "uganda");
  assert.equal(resolve("Ankara, Türkiye"), "turkiye");
  assert.equal(resolve("Istanbul, Turkey"), "turkiye");
  assert.equal(resolve("北京市丰台区, 中国"), "china");
  assert.equal(resolve("乌干达阿鲁阿"), "uganda");
});

test("the title's country lead is the fallback, and only the lead is read", () => {
  assert.equal(resolve("Bad Ischl", "Austria – Works for complete or part construction"), "austria");
  assert.equal(resolve(null, "Romania – Specialty design services – Servicii"), "romania");
  // A country named later in the title is the subject, not the place.
  assert.equal(resolve("Burg", "Ersatzneubau Betriebsstelle - Generalplanerleistungen for Germany"), null);
  assert.equal(resolve(null, null), null);
});

test("short or shared names do not match inside running text", () => {
  // "oman" is a country but also part of "Romano"; "congo" and "georgia" name more than one place.
  assert.equal(resolve("Romano d'Ezzelino"), null);
  assert.equal(resolve("Congo"), null);
  assert.equal(resolve("Georgia"), null);
  assert.equal(resolve("Erfurter Str. 30-26"), null);
  assert.equal(resolve("Municipiul Craiova"), null);
});
