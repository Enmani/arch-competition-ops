import assert from "node:assert/strict";
import test from "node:test";

import { buildGeocodeQueries, resolveGeocodeQueries } from "./queries";

test("resolveGeocodeQueries generates reusable conservative geocoder permutations", () => {
  const queries = resolveGeocodeQueries(
    {
      authorityName: "Consejero Director de la Gerencia Municipal de Urbanismo del Ayuntamiento de Santa Cruz de Tenerife",
      briefPdfUrl: null,
      documentsPortalUrl: null,
      jurisdictionKey: "spain",
      jurisdictionLabel: "Spain",
      locationLabel: "Santa Cruz de Tenerife",
      officialUrl: null,
      slug: "sample",
      sourceUrl: null,
      title: "Contrato de obras para la adopción de medidas de seguridad en inmueble sito en C/ Mayántigo, Barrio Acorán, Distrito Suroeste de esta localidad",
    },
    {
      address: "C/ Mayántigo",
      kind: "street",
      localityHint: "Barrio Acorán",
      source: "title",
    },
  );

  assert.deepEqual(queries, ["Calle Mayántigo, Acorán, Santa Cruz de Tenerife, Spain"]);
});

test("resolveGeocodeQueries adds italian locality hints captured from title tails", () => {
  const queries = resolveGeocodeQueries(
    {
      authorityName: "MONTEDOMINI AZIENDA PUBBLICA DI SERVIZI ALLA PERSONA",
      briefPdfUrl: null,
      documentsPortalUrl: null,
      jurisdictionKey: "italy",
      jurisdictionLabel: "Italy",
      locationLabel: null,
      officialUrl: null,
      slug: "sample",
      sourceUrl: null,
      title: "Incarico tecnico per adeguamento antincendio presso la sede di Via de Malcontenti n. 6 Firenze",
    },
    {
      address: "Via de Malcontenti n. 6",
      kind: "street_address",
      localityHint: "Firenze",
      source: "title",
    },
  );

  assert.deepEqual(queries, ["Via de Malcontenti 6, Firenze, Italy"]);
});

test("resolveGeocodeQueries keeps portuguese address, locality, and country ordering conservative", () => {
  const queries = resolveGeocodeQueries(
    {
      authorityName: "Município do Porto",
      briefPdfUrl: null,
      documentsPortalUrl: null,
      jurisdictionKey: "portugal",
      jurisdictionLabel: "Portugal",
      locationLabel: null,
      officialUrl: null,
      slug: "sample",
      sourceUrl: null,
      title: "Empreitada de reabilitação do edifício sito na Rua das Flores 12, em Porto",
    },
    {
      address: "Rua das Flores 12",
      kind: "street_address",
      localityHint: "Porto",
      source: "title",
    },
  );

  assert.deepEqual(queries, ["Rua das Flores 12, Porto, Portugal"]);
});

test("resolveGeocodeQueries preserves polish street abbreviations without duplicating prefixes", () => {
  const queries = resolveGeocodeQueries(
    {
      authorityName: "Gmina Miasto Suwałki",
      briefPdfUrl: null,
      documentsPortalUrl: null,
      jurisdictionKey: "poland",
      jurisdictionLabel: "Poland",
      locationLabel: null,
      officialUrl: null,
      slug: "sample",
      sourceUrl: null,
      title:
        "Opracowanie dokumentacji projektowej na wykonanie wewnętrznej instalacji c.o. i c.w.u. przy ul. Noniewicza 31 w Suwałkach",
    },
    {
      address: "ul. Noniewicza 31",
      kind: "street_address",
      localityHint: "Suwałkach",
      source: "title",
    },
  );

  assert.deepEqual(queries, ["Ulica Noniewicza 31, Suwałkach, Suwałki, Poland"]);
});

test("resolveGeocodeQueries keeps norwegian municipal city alongside street addresses", () => {
  const queries = resolveGeocodeQueries(
    {
      authorityName: "Oslo kommune v/ Eiendoms- og byfornyelsesetaten",
      briefPdfUrl: null,
      documentsPortalUrl: null,
      jurisdictionKey: "norway",
      jurisdictionLabel: "Norway",
      locationLabel: null,
      officialUrl: null,
      slug: "sample",
      sourceUrl: null,
      title: "Utarbeidelse av reguleringsplan, Økern Torgvei 2",
    },
    {
      address: "Økern Torgvei 2",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
  );

  assert.deepEqual(queries, ["Økern Torgvei 2, Oslo, Norway"]);
});

test("resolveGeocodeQueries builds city-level locality lookups from cleaned display locality", () => {
  const queries = resolveGeocodeQueries(
    {
      authorityName: "Ville de Lyon",
      briefPdfUrl: null,
      documentsPortalUrl: null,
      jurisdictionKey: "france",
      jurisdictionLabel: "France",
      locationLabel: "Lyon",
      officialUrl: null,
      slug: "sample",
      sourceUrl: null,
      title:
        "France – Architectural and related services – Halles de Lyon Paul Bocuse - Travaux de réalisation du schéma directeur de sécurité incendie",
    },
    {
      address: "Lyon",
      kind: "locality",
      localityHint: null,
      source: "title",
    },
  );

  assert.deepEqual(queries, ["Lyon, France"]);
});

test("resolveGeocodeQueries builds conservative chinese project-location searches", () => {
  const queries = resolveGeocodeQueries(
    {
      authorityName: "北京市延庆区教育委员会",
      briefPdfUrl: null,
      documentsPortalUrl: null,
      jurisdictionKey: "china",
      jurisdictionLabel: "China",
      locationLabel: "北京",
      officialUrl: null,
      slug: "sample",
      sourceUrl: null,
      title: "十一学校延庆校区项目（方案设计、初步设计）招标公告",
    },
    {
      address: "延庆新城YQ00-0309街区",
      kind: "site",
      localityHint: "北京市延庆区",
      source: "page",
    },
  );

  assert.deepEqual(queries, ["延庆新城YQ00-0309街区, 北京市延庆区, 北京, China"]);
});

test("buildGeocodeQueries keeps shorter fallback queries available for stubborn street matches", () => {
  const queries = buildGeocodeQueries(
    {
      authorityName: "Comune di Collarmele",
      briefPdfUrl: null,
      documentsPortalUrl: null,
      jurisdictionKey: "italy",
      jurisdictionLabel: "Italy",
      locationLabel: "Collarmele",
      officialUrl: null,
      slug: "sample",
      sourceUrl: null,
      title: "Affidamento lavori di miglioramento energetico in Via Tramontana n. 6",
    },
    {
      address: "Via Tramontana n. 6",
      kind: "street_address",
      localityHint: "Collarmele",
      source: "title",
    },
    {
      includeJurisdictionLabel: false,
    },
  );

  assert.ok(queries.includes("Via Tramontana 6, Collarmele"));
});
