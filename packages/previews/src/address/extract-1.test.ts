import assert from "node:assert/strict";
import test from "node:test";

import { extractAddressCandidatesFromPdfText, extractAddressCandidatesFromText } from "./extract";

test("extractAddressCandidatesFromText keeps a street candidate with barrio locality hint", () => {
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
    "Affidamento dei servizi tecnici per lavori su edificio scolastico censita al N.C.E.U. al foglio 77 part. 561. Direzione dei lavori.",
    "title",
  );

  assert.deepEqual(candidates, []);
});

test("extractAddressCandidatesFromPdfText normalizes hyphenated line breaks before extraction", () => {
  const candidates = extractAddressCandidatesFromPdfText(
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
  const candidates = extractAddressCandidatesFromPdfText(
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

test("extractAddressCandidatesFromText captures locality before trailing descriptive clauses", () => {
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
    "About the buyer Contact name Karen Chapman Address 81 Walton Road AYLESBURY HP217SN England Telephone 07823 881536 Email projectmanager@planningofficers.org.uk Website https://www.planningofficers.org.uk/",
    "page",
  );

  assert.deepEqual(candidates, []);
});

test("extractAddressCandidatesFromText filters footer chrome noise from page text", () => {
  const candidates = extractAddressCandidatesFromText(
    "Vai al footer Contenuti in evidenza Notizie 03-07 Piazza Cento Noci Comune di Favale di Malvaro amministrazione trasparente",
    "page",
  );

  assert.deepEqual(candidates, []);
});

test("extractAddressCandidatesFromText keeps project addresses when contact blocks also exist on page", () => {
  const candidates = extractAddressCandidatesFromText(
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
  const candidates = extractAddressCandidatesFromText(
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

test("extractAddressCandidatesFromText recognizes chinese campus and boundary-road location hints from notice text", () => {
  const candidates = extractAddressCandidatesFromText(
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
