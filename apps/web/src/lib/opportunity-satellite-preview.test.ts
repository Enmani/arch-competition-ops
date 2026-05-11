import assert from "node:assert/strict";
import test from "node:test";

import { satellitePreviewTestUtils } from "./opportunity-satellite-preview.ts";

test("extractAddressCandidatesFromText keeps a street candidate with barrio locality hint", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Contrato de obras para la adopción de medidas de seguridad en inmueble sito en C/ Mayántigo, Barrio Acorán, Distrito Suroeste de esta localidad",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "C/ Mayántigo",
      kind: "street",
      localityHint: "Barrio Acorán",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText ignores article and comma abbreviations that are not real addresses", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Affidamento diretto, ai sensi dell'art. 50, c. 1, lett. b), del D.Lgs n. 36/2023 relativo ai lavori in via Vitulanese 104.",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "via Vitulanese 104",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
    {
      address: "via Vitulanese 104",
      kind: "street",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText can extract a campus site candidate", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Affidamento del servizio di supporto al RUP per la verifica della progettazione esecutiva e la validazione del progetto relativo alla realizzazione e sistemazione dei parcheggi a raso nel Campus Bizzozero di Varese, comprensivo dei sistemi per il pagamento della sosta.",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Campus Bizzozero di Varese",
      kind: "site",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText trims lot and quantity noise from french street candidates", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Missions de maîtrise d'oeuvre pour des travaux de construction : - LOT 1 : 38 logements collectifs rue des Canadiens à Rouen - LOT 2 : 26 logements collectifs rue Gaston Contremoulins à Rouen pour l'OPH ROUEN HABITAT",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "rue des Canadiens à Rouen",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
    {
      address: "rue Gaston Contremoulins à Rouen",
      kind: "street",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText trims french quantity tails after street labels", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "MISSION DE MAITRISE D'OEUVRE DANS LE CADRE DE LA REHABILITATION DE 24 LOGEMENTS COLLECTIFS RUE LEGRAND D'AUSSY, 38 LOGEMENTS COLLECTIFS RUE DU BELLAY ET RUE ALFRED LEMAIRE, 34 LOGEMENTS COLLECTIFS RUE",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "RUE LEGRAND D'AUSSY, 38",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
    {
      address: "RUE DU BELLAY ET RUE ALFRED LEMAIRE, 34",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
    {
      address: "RUE LEGRAND D'AUSSY",
      kind: "street",
      localityHint: null,
      source: "title",
    },
    {
      address: "RUE DU BELLAY ET RUE ALFRED LEMAIRE",
      kind: "street",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes portuguese street prefixes and locality tails", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Empreitada de reabilitação do edifício sito na Rua das Flores 12, em Porto.",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Rua das Flores 12",
      kind: "street_address",
      localityHint: "Porto",
      source: "title",
    },
    {
      address: "Rua das Flores 12",
      kind: "street",
      localityHint: "Porto",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes dutch trailing street names with house numbers", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Renovatie van het pand aan Kerkstraat 12, Amsterdam.",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Kerkstraat 12",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes nordic trailing street names with house numbers", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Ombyggnad av fastighet på Storgatan 5, Uppsala.",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Storgatan 5",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes finnish trailing street names with house numbers", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Peruskorjaus, Helsinki, Heka Ylä-Malmi Markkinatie 16",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Ylä-Malmi Markkinatie 16",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes polish abbreviated street prefixes", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Opracowanie dokumentacji projektowej przy ul. Noniewicza 31 w Suwałkach.",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "ul. Noniewicza 31",
      kind: "street_address",
      localityHint: "Suwałkach",
      source: "title",
    },
    {
      address: "ul. Noniewicza 31",
      kind: "street",
      localityHint: "Suwałkach",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes central european trailing street names with house numbers", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Preureditev objekta na naslovu Prešernova cesta 11, Radovljica.",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Prešernova cesta 11",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes german trailing street names with ranged house numbers", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "PROJEKT Prellerweg 47 - 49 12157 Berlin",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Prellerweg 47 - 49",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("expandAddressVariantsForGeocoder splits compound plaza and street references", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder(
    "Plaza Alcalde Tomas Carrión con Calle San Andrés",
  );

  assert.deepEqual(variants, [
    "Plaza Alcalde Tomas Carrión con Calle San Andrés",
    "Plaza Alcalde Tomas Carrión",
    "Calle San Andrés",
  ]);
});

test("expandAddressVariantsForGeocoder unwraps nested street labels", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder(
    "Calle Transversal a la Calle Cecilio Montes",
  );

  assert.deepEqual(variants, ["Calle Transversal a la Calle Cecilio Montes"]);
});

test("expandLocalityVariantsForGeocoder keeps both stripped and original locality hints", () => {
  const variants = satellitePreviewTestUtils.expandLocalityVariantsForGeocoder(
    "Urbanización Parque del Cubillas",
  );

  assert.deepEqual(variants, ["Parque del Cubillas", "Urbanización Parque del Cubillas"]);
});

test("expandAddressVariantsForGeocoder normalizes campus site variants", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder(
    "Campus Bizzozero di Varese",
  );

  assert.deepEqual(variants, ["Campus Bizzozero di Varese", "Campus Bizzozero Varese"]);
});

test("expandAddressVariantsForGeocoder creates searchable university campus aliases", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder(
    "Campus Universitario de Segovia de la Universidad de Valladolid",
  );

  assert.deepEqual(variants, [
    "Campus Universitario de Segovia de la Universidad de Valladolid",
    "Campus Universitario Segovia de la Universidad de Valladolid",
    "Campus Segovia",
    "Campus Segovia Valladolid",
    "Campus Segovia UVa",
  ]);
});

test("expandAddressVariantsForGeocoder compresses IUT campus names into institutional aliases", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder(
    "campus IUT Nîmes Université de Montpellier",
  );

  assert.deepEqual(variants, [
    "campus IUT Nîmes Université de Montpellier",
    "campus IUT Nîmes Université Montpellier",
    "IUT Nîmes",
    "Institut Universitaire de Technologie de Nîmes",
  ]);
});

test("extractStructuredAddressCandidatesFromHtml reads precise address from blocked-page meta tags", () => {
  const candidates = satellitePreviewTestUtils.extractStructuredAddressCandidatesFromHtml(`
    <html>
      <head>
        <meta name="geo.placename" content="via Ravasi 2, 21100 Varese" />
        <meta property="og:street_address" content="via Ravasi 2" />
        <meta property="og:locality" content="Varese" />
        <meta property="og:postal_code" content="21100" />
      </head>
    </html>
  `);

  assert.deepEqual(candidates, [
    {
      address: "via Ravasi 2",
      kind: "street_address",
      localityHint: "Varese",
      source: "page",
    },
  ]);
});

test("extractStructuredAddressCandidatesFromHtml reads campus site address from json-ld", () => {
  const candidates = satellitePreviewTestUtils.extractStructuredAddressCandidatesFromHtml(`
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Place",
            "name": "Campus Bizzozero di Varese",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "Campus Bizzozero di Varese",
              "addressLocality": "Varese",
              "addressCountry": "Italy"
            }
          }
        </script>
      </head>
    </html>
  `);

  assert.deepEqual(candidates, [
    {
      address: "Campus Bizzozero di Varese",
      kind: "site",
      localityHint: "Varese",
      source: "page",
    },
  ]);
});

test("extractPdfUrlsFromHtml resolves relative and absolute pdf attachments", () => {
  const urls = satellitePreviewTestUtils.extractPdfUrlsFromHtml(
    `
      <html>
        <body>
          <a href="/files/memoria.pdf">Memoria</a>
          <a href="https://example.org/docs/plans.pdf?download=1">Plans</a>
          <a href="mailto:test@example.org">Mail</a>
          <iframe src="./annex/specification.pdf"></iframe>
        </body>
      </html>
    `,
    "https://procurement.example.org/notices/123",
  );

  assert.deepEqual(urls, [
    "https://procurement.example.org/files/memoria.pdf",
    "https://example.org/docs/plans.pdf?download=1",
    "https://procurement.example.org/notices/annex/specification.pdf",
  ]);
});

test("extractPdfUrlsFromHtml reads script-embedded project attachments and filters legal pdf noise", () => {
  const urls = satellitePreviewTestUtils.extractPdfUrlsFromHtml(
    `
      <html>
        <body>
          <script>
            var documentsAttachments = [{
              "rows":[
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=abc123\\">Project_Brief.pdf<\\/a>"}]},
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/pdf\\/de\\/rib-itwo-tender-nutzungsbedingungen-08-2023.pdf\\">Terms<\\/a>"}]}
              ]
            }];
          </script>
        </body>
      </html>
    `,
    "https://procurement.example.org/notices/123",
  );

  assert.deepEqual(urls, ["https://procurement.example.org/remote/download.php?k=abc123"]);
});

test("extractPdfUrlsFromHtml ranks site-plan style attachments ahead of generic forms", () => {
  const urls = satellitePreviewTestUtils.extractPdfUrlsFromHtml(
    `
      <html>
        <body>
          <script>
            var documentsAttachments = [{
              "rows":[
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=form001\\">Teilnahmeantrag.pdf<\\/a>"}]},
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=plan001\\">Amtlicher Lageplan.pdf<\\/a>"}]},
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=brief001\\">Leistungsbeschreibung.pdf<\\/a>"}]}
              ]
            }];
          </script>
        </body>
      </html>
    `,
    "https://procurement.example.org/notices/123",
  );

  assert.deepEqual(urls, [
    "https://procurement.example.org/remote/download.php?k=plan001",
    "https://procurement.example.org/remote/download.php?k=brief001",
    "https://procurement.example.org/remote/download.php?k=form001",
  ]);
});

test("extractPdfUrlsFromHtml ranks escaped script attachment titles instead of hash urls", () => {
  const urls = satellitePreviewTestUtils.extractPdfUrlsFromHtml(
    `
      <html>
        <body>
          <script>
            var documentsAttachments = [{
              "rows":[
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=form001\\">Teilnahmeantrag.pdf<\\/a>"}]},
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=plan001\\">Amtlicher Lageplan.pdf<\\/a>"}]},
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=brief001\\">Leistungsbeschreibung.pdf<\\/a>"}]}
              ]
            }];
          </script>
        </body>
      </html>
    `,
    "https://procurement.example.org/notices/123",
  );

  assert.deepEqual(urls, [
    "https://procurement.example.org/remote/download.php?k=plan001",
    "https://procurement.example.org/remote/download.php?k=brief001",
    "https://procurement.example.org/remote/download.php?k=form001",
  ]);
});

test("extractAddressCandidatesFromPdfText normalizes hyphenated line breaks before extraction", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromPdfText(
    "MEMORIA JUSTIFICATIVA\nobra de rehabi-\nlitación del edificio que se incardina en avenida Barcelona nº 18\n46135 Emperador [VALENCIA]",
  );

  assert.deepEqual(candidates, [
    {
      address: "avenida Barcelona nº 18",
      kind: "street_address",
      localityHint: "Emperador",
      source: "page",
    },
    {
      address: "avenida Barcelona nº 18",
      kind: "street",
      localityHint: "Emperador",
      source: "page",
    },
  ]);
});

test("extractAddressCandidatesFromPdfText recognizes german straße suffixes inside object tables", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromPdfText(
    "Adresse: Liebenwalder Straße 5 Projektnummer: PI-28-7343-001 Quartier: Gesundbrunnen Wirtschaftseinheit: H0923",
  );

  assert.deepEqual(candidates, [
    {
      address: "Liebenwalder Straße 5",
      kind: "street_address",
      localityHint: null,
      source: "page",
    },
  ]);
});

test("resolveGeocodeQueries generates reusable conservative geocoder permutations", () => {
  const queries = satellitePreviewTestUtils.resolveGeocodeQueries(
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
  const queries = satellitePreviewTestUtils.resolveGeocodeQueries(
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
  const queries = satellitePreviewTestUtils.resolveGeocodeQueries(
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
  const queries = satellitePreviewTestUtils.resolveGeocodeQueries(
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
  const queries = satellitePreviewTestUtils.resolveGeocodeQueries(
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

test("extractAddressCandidatesFromText captures locality before trailing descriptive clauses", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Izdelava projektne dokumentacije za preureditev objekta na naslovu Prešernova cesta 11, Radovljica, z upoštevanjem okoljskih vidikov.",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Prešernova cesta 11",
      kind: "street_address",
      localityHint: "Radovljica",
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText filters buyer contact addresses from page text", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "About the buyer Contact name Karen Chapman Address 81 Walton Road AYLESBURY HP217SN England Telephone 07823 881536 Email projectmanager@planningofficers.org.uk Website https://www.planningofficers.org.uk/",
    "page",
  );

  assert.deepEqual(candidates, []);
});

test("extractAddressCandidatesFromText filters footer chrome noise from page text", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Vai al footer Contenuti in evidenza Notizie 03-07 Piazza Cento Noci Comune di Favale di Malvaro amministrazione trasparente",
    "page",
  );

  assert.deepEqual(candidates, []);
});

test("extractAddressCandidatesFromText keeps project addresses when contact blocks also exist on page", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Serve aiuto? Accedi ATER L'AQUILA Via Antica Arischia, 46/E - 67100 L'Aquila 0862.2791 0862.412296 amministrazione@ateraq.it posta.certificata@ateraq.legalmail.it Descrizione lavori di miglioramento energetico del fabbricato n.1286 - Via Tramontana n. 6, Collarmele (AQ)",
    "page",
  );

  assert.deepEqual(candidates, [
    {
      address: "Via Tramontana n. 6",
      kind: "street_address",
      localityHint: "Collarmele",
      source: "page",
    },
    {
      address: "Via Tramontana n. 6",
      kind: "street",
      localityHint: "Collarmele",
      source: "page",
    },
  ]);
});

test("extractAddressCandidatesFromText keeps project street address and filters plan contact addresses from pdf-like page text", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Action Straße 5 Dates and deadlines Period Expiration time Jun 8",
    "page",
  );

  assert.deepEqual(candidates, []);
});
