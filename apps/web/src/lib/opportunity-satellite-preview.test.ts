import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { isInvalidSatellitePreviewBuffer } from "./opportunity-satellite-preview-quality";
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

test("extractAddressCandidatesFromText trims italian public-notice tails after street addresses", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "progettazione esecutiva architettonica e strutturale relativa ai lavori della mensa scolastica sede di Magliano Romano in Via Romana 29. Nell'ambito dell'Avviso Pubblico n. 104609 del 29 luglio 2024",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Via Romana 29",
      kind: "street_address",
      localityHint: null,
      source: "title",
    },
    {
      address: "Via Romana 29",
      kind: "street",
      localityHint: null,
      source: "title",
    },
  ]);
});

test("extractAddressCandidatesFromText rejects cadastral reference spillover as street candidates", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Affidamento dei servizi tecnici per lavori su edificio scolastico censita al N.C.E.U. al foglio 77 part. 561. Direzione dei lavori.",
    "title",
  );

  assert.deepEqual(candidates, []);
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

test("resolveGeocodeQueries builds city-level locality lookups from cleaned display locality", () => {
  const queries = satellitePreviewTestUtils.resolveGeocodeQueries(
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

test("extractAddressCandidatesFromText trims italian comune wrappers from locality hints", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "Servizi di ingegneria e architettura per l’intervento presso Piazza Bagni, nel Comune di Casamicciola Terme (NA)",
    "title",
  );

  assert.deepEqual(candidates, [
    {
      address: "Piazza Bagni",
      kind: "street",
      localityHint: "Casamicciola Terme",
      source: "title",
    },
  ]);
});

test("expandAddressVariantsForGeocoder keeps chinese village numbers and broader village aliases", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder("黄庄村43号");

  assert.deepEqual(variants, ["黄庄村43号", "黄庄村"]);
});

test("extractAddressCandidatesFromText recognizes chinese campus and boundary-road location hints from notice text", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "本次招标项目建设地点：北京市延庆区位于延庆新城YQ00-0309街区，东至延康路、南至圣百街、西至规划下屯东路，北至百康路。",
    "page",
  );

  assert.deepEqual(candidates, [
    {
      address: "延庆新城YQ00-0309街区",
      kind: "site",
      localityHint: "北京市延庆区",
      source: "page",
    },
    {
      address: "延康路",
      kind: "street",
      localityHint: "北京市延庆区",
      source: "page",
    },
    {
      address: "圣百街",
      kind: "street",
      localityHint: "北京市延庆区",
      source: "page",
    },
    {
      address: "规划下屯东路",
      kind: "street",
      localityHint: "北京市延庆区",
      source: "page",
    },
    {
      address: "百康路",
      kind: "street",
      localityHint: "北京市延庆区",
      source: "page",
    },
  ]);
});

test("extractAddressCandidatesFromText recognizes chinese engineering-place fields with street addresses and villages", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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

test("resolveGeocodeQueries builds conservative chinese project-location searches", () => {
  const queries = satellitePreviewTestUtils.resolveGeocodeQueries(
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
  const queries = satellitePreviewTestUtils.buildGeocodeQueries(
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

test("extractAddressCandidatesFromText rejects procedural address noise from titles", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "INCARICO PER L'ASSOLVIMENTO DEGLI OBBLIGHI PREVISTI DAL D. LGS. 81/2008 IN CAPO AL COORDINATORE PER LA SICUREZZA IN FASE DI PROGETTAZIONE E DI ESECUZIONE",
    "title",
  );

  assert.deepEqual(candidates, []);
});

test("extractAddressCandidatesFromText trims german functional prefixes before bare street titles", () => {
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
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
  const candidates = satellitePreviewTestUtils.extractAddressCandidatesFromText(
    "accordo quadro per servizi tecnici di ingegneria architettura e geologia per gli interventi relativi al patrimonio del comune di montale pfte per la realizzazione di un nuovo parcheggio a tobbiana montale pt al massimo 200 caratteri Indietro Avanti Grazie",
    "page",
  );

  assert.deepEqual(candidates, []);
});

test("expandAddressVariantsForGeocoder reorders french number-leading street addresses", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder(
    "34 avenue d'Izon",
  );

  assert.deepEqual(variants, ["34 avenue d'Izon", "avenue d'Izon 34"]);
});

test("expandLocalityVariantsForGeocoder keeps stripped variants for european site wrappers", () => {
  const variants = satellitePreviewTestUtils.expandLocalityVariantsForGeocoder(
    "Lotissement Herbstweg",
  );

  assert.deepEqual(variants, ["Herbstweg", "Lotissement Herbstweg"]);
});

test("expandAddressVariantsForGeocoder strips non-campus site wrappers for broader geocoding", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder(
    "Urbanización Prado Cerrado",
  );

  assert.deepEqual(variants, ["Urbanización Prado Cerrado", "Prado Cerrado"]);
});

test("expandAddressVariantsForGeocoder strips french site wrappers and keeps city-bound variants", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder(
    "ZAC Val de Sermon Ilot B à Mordelles",
  );

  assert.deepEqual(variants, [
    "ZAC Val de Sermon Ilot B à Mordelles",
    "Val de Sermon Ilot B à Mordelles",
    "ZAC Val de Sermon Ilot B",
    "ZAC Val de Sermon Ilot B Mordelles",
  ]);
});

test("expandAddressVariantsForGeocoder strips facility lead-ins before german street tails", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder(
    "Begegnungszentrum Westerwaldstraße",
  );

  assert.deepEqual(variants, ["Begegnungszentrum Westerwaldstraße", "Westerwaldstraße"]);
});

test("expandAddressVariantsForGeocoder adds chinese institution cores and street-number variants", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder(
    "黄冈师范学院东校区学生宿舍A、B栋",
  );

  assert.deepEqual(variants, [
    "黄冈师范学院东校区学生宿舍A、B栋",
    "黄冈师范学院东校区",
    "黄冈师范学院",
  ]);
});

test("expandAddressVariantsForGeocoder keeps spaced chinese road-number variants for nominatim", () => {
  const variants = satellitePreviewTestUtils.expandAddressVariantsForGeocoder("燕江东路86号");

  assert.deepEqual(variants, ["燕江东路86号", "燕江东路 86 号", "燕江东路"]);
});

test("isAcceptableGeocodeResult accepts broader street-level square matches for circle overlays", () => {
  const accepted = satellitePreviewTestUtils.isAcceptableGeocodeResult(
    {
      addresstype: "square",
      boundingbox: ["41.3810", "41.3840", "2.1710", "2.1760"],
      category: "place",
      type: "square",
    },
    {
      address: "Plaza Mayor",
      kind: "street",
      localityHint: "Madrid",
      source: "title",
    },
  );

  assert.equal(accepted, true);
});

test("isAcceptableGeocodeResult accepts city-scale locality matches within relaxed bounds", () => {
  const accepted = satellitePreviewTestUtils.isAcceptableGeocodeResult(
    {
      addresstype: "city",
      boundingbox: ["45.4600", "45.5200", "9.1200", "9.2000"],
      category: "place",
      type: "city",
    },
    {
      address: "Milano",
      kind: "locality",
      localityHint: null,
      source: "title",
    },
  );

  assert.equal(accepted, true);
});

test("isAcceptableGeocodeResult rejects overly broad locality matches", () => {
  const accepted = satellitePreviewTestUtils.isAcceptableGeocodeResult(
    {
      addresstype: "city",
      boundingbox: ["41.0000", "42.5000", "1.0000", "3.5000"],
      category: "place",
      type: "city",
    },
    {
      address: "Barcelona",
      kind: "locality",
      localityHint: null,
      source: "title",
    },
  );

  assert.equal(accepted, false);
});

test("resolveChineseGeocodePrecision maps POI-style site results to site overlays", () => {
  const precision = satellitePreviewTestUtils.resolveChineseGeocodePrecision(
    {
      address: "黄冈师范学院东校区",
      kind: "site",
      localityHint: "黄冈市",
      source: "page",
    },
    "兴趣点",
  );

  assert.equal(precision, "site");
});

test("isAcceptableBaiduGeocodeResult accepts precise chinese street-address matches", () => {
  const accepted = satellitePreviewTestUtils.isAcceptableBaiduGeocodeResult(
    {
      confidence: 62,
      level: "门址",
      location: {
        lat: 30.5153,
        lng: 114.3187,
      },
      precise: 1,
    },
    {
      address: "龙泉路 237 号",
      kind: "street_address",
      localityHint: "昆明市",
      source: "page",
    },
  );

  assert.equal(accepted, true);
});

test("isAcceptableAmapGeocodeResult rejects province-only chinese results for street candidates", () => {
  const accepted = satellitePreviewTestUtils.isAcceptableAmapGeocodeResult(
    {
      level: "省",
      location: "102.7123,25.0406",
    },
    {
      address: "龙泉路",
      kind: "street",
      localityHint: "昆明市",
      source: "page",
    },
  );

  assert.equal(accepted, false);
});

test("gcj02ToWgs84 keeps china coordinates close while normalizing map provider output", () => {
  const converted = satellitePreviewTestUtils.gcj02ToWgs84(39.908823, 116.39747);

  assert.ok(Math.abs(converted.lat - 39.9074) < 0.01);
  assert.ok(Math.abs(converted.lng - 116.3912) < 0.01);
});

test("bd09ToWgs84 keeps baidu coordinates close while normalizing map provider output", () => {
  const converted = satellitePreviewTestUtils.bd09ToWgs84(39.915, 116.404);

  assert.ok(Math.abs(converted.lat - 39.907) < 0.02);
  assert.ok(Math.abs(converted.lng - 116.391) < 0.02);
});

test("buildBaiduSignedUrl preserves the unsigned geocoder url when no SK is configured", () => {
  const params = new URLSearchParams({
    address: "黄冈师范学院东校区",
    ak: "demo-ak",
    output: "json",
    ret_coordtype: "bd09ll",
  });

  const url = satellitePreviewTestUtils.buildBaiduSignedUrl(
    "https://api.map.baidu.com/geocoding/v3/",
    params,
  );

  assert.equal(
    url,
    "https://api.map.baidu.com/geocoding/v3/?address=%E9%BB%84%E5%86%88%E5%B8%88%E8%8C%83%E5%AD%A6%E9%99%A2%E4%B8%9C%E6%A0%A1%E5%8C%BA&ak=demo-ak&output=json&ret_coordtype=bd09ll",
  );
});

test("resolveGeocodePrecision marks broad municipal locality results as city precision", () => {
  const precision = satellitePreviewTestUtils.resolveGeocodePrecision(
    {
      addresstype: "municipality",
      type: "administrative",
    },
    {
      address: "Porto",
      kind: "locality",
      localityHint: null,
      source: "title",
    },
  );

  assert.equal(precision, "locality");
});

test("isInvalidSatellitePreviewBuffer rejects low-entropy pseudo-preview images", async () => {
  const fakePreview = await sharp({
    create: {
      background: "#ddd8cc",
      channels: 3,
      height: 720,
      width: 720,
    },
  })
    .jpeg({ mozjpeg: true, quality: 84 })
    .toBuffer();

  const invalid = await isInvalidSatellitePreviewBuffer(fakePreview);

  assert.equal(invalid, true);
});
