import assert from "node:assert/strict";
import test from "node:test";

import { buildOpportunityLocatorInsetSvg, buildOpportunityLocatorPlaceholderSvg } from "./render";

test("buildOpportunityLocatorPlaceholderSvg fills the frame with the outline and no labels", () => {
  const svg = buildOpportunityLocatorPlaceholderSvg({
    authorityName: "Commune de Lausanne",
    geoLat: null,
    geoLng: null,
    jurisdictionKey: "switzerland",
    jurisdictionLabel: "Switzerland",
    locationLabel: null,
    title: "Concorso, 1005 Lausanne",
  });

  // Edge to edge: the whole square panel is the paper and the locator grid.
  assert.match(svg, /viewBox="52 52 616 616"/);
  assert.match(svg, /<rect x="52" y="52" width="616" height="616" fill="url\(#locator-grid\)"/);
  // Country and city are set in type under the image, never inside it.
  assert.doesNotMatch(svg, /<text/);
  assert.doesNotMatch(svg, />CH</);
  assert.match(svg, /id="country-outline"/);
  assert.match(svg, /data-outline-source="world-atlas"/);
  assert.match(svg, /data-country-key="switzerland"/);
  assert.match(svg, /data-marker-source="country-centroid"/);
  assert.doesNotMatch(svg, /stroke="#285f47" stroke-width="3"/);
});

test("buildOpportunityLocatorPlaceholderSvg projects known coordinates onto the country outline", () => {
  const svg = buildOpportunityLocatorPlaceholderSvg({
    authorityName: "Commune de Maur",
    geoLat: 47.3407,
    geoLng: 8.671,
    jurisdictionKey: "switzerland",
    jurisdictionLabel: "Switzerland",
    locationLabel: "Maur",
    title: "Extension du complexe sportif et de loisirs Looren, 8124 Maur",
  });

  assert.match(svg, /data-marker-source="geo-coordinates"/);
  assert.doesNotMatch(svg, /translate\(345 290\)/);
});

test("with no country and no place name the card is the neutral grid and nothing else", () => {
  const svg = buildOpportunityLocatorPlaceholderSvg();

  assert.doesNotMatch(svg, /id="country-outline"/);
  assert.doesNotMatch(svg, /<text/);
  assert.doesNotMatch(svg, /data-marker-source/);
});

test("with no country but a place name the card shows the name, not an empty grid or a made-up marker", () => {
  const svg = buildOpportunityLocatorPlaceholderSvg({
    authorityName: "Erfurt",
    jurisdictionKey: "eu",
    jurisdictionLabel: "Eu",
    locationLabel: "Municipiul Craiova <&>",
    title: "Servicii de proiectare",
  });

  assert.doesNotMatch(svg, /id="country-outline"/);
  assert.doesNotMatch(svg, /data-marker-source/);
  assert.match(svg, /<text [^>]*>Municipiul<\/text>/);
  assert.match(svg, /Craiova &lt;&amp;&gt;/, "the name is escaped");
  // Chinese place names wrap on characters and stay within three lines.
  const han = buildOpportunityLocatorPlaceholderSvg({
    authorityName: "",
    jurisdictionKey: "global",
    jurisdictionLabel: "Global",
    locationLabel: "某某省某某市某某区某某街道某某路某某号某某大厦某某楼某某室某某单位",
    title: "",
  });
  assert.equal((han.match(/<text /g) ?? []).length, 3);
  assert.match(han, /…<\/text>/);
});

test("a generic jurisdiction still gets its country's outline when the record's own text names it", () => {
  const draw = (jurisdictionKey: string, locationLabel: string | null, title: string) =>
    buildOpportunityLocatorPlaceholderSvg({
      authorityName: "",
      jurisdictionKey,
      jurisdictionLabel: jurisdictionKey,
      locationLabel,
      title,
    });

  assert.match(draw("eu", "Côte d'Ivoire", "France – Survey services"), /data-country-key="cote_d_ivoire"/);
  assert.match(draw("global", "à Nouakchott, en Mauritanie", "Projet d'Extension"), /data-country-key="mauritania"/);
  assert.match(draw("eu", "Bad Ischl", "Austria – Works for complete construction"), /data-country-key="austria"/);
  assert.match(draw("europe", null, "Romania – Specialty design services"), /data-country-key="romania"/);
  // Countries that used to have no outline at all.
  assert.match(draw("poland", null, ""), /id="country-outline"/);
  assert.match(draw("netherlands", null, ""), /id="country-outline"/);
  assert.match(draw("uganda", null, ""), /id="country-outline"/);
});

test("the marker position equals what d3.geoMercator computes from the stored projection", async () => {
  const { geoMercator } = await import("d3-geo");
  const { default: outlines } = await import("../../data/country-outlines.json", {
    with: { type: "json" },
  });
  const swiss = outlines.countries.switzerland;
  const projection = geoMercator().scale(swiss.scale).translate(swiss.translate as [number, number]);
  const [expectedX, expectedY] = projection([8.671, 47.3407]) as [number, number];

  const svg = buildOpportunityLocatorPlaceholderSvg({
    authorityName: "Commune de Maur",
    geoLat: 47.3407,
    geoLng: 8.671,
    jurisdictionKey: "switzerland",
    jurisdictionLabel: "Switzerland",
    locationLabel: "Maur",
    title: "Looren",
  });

  const match = /translate\(([-\d.]+) ([-\d.]+)\)" data-marker-source="geo-coordinates"/.exec(svg);
  assert.ok(match, "marker group with projected coordinates is rendered");
  assert.ok(Math.abs(Number(match[1]) - expectedX) < 1e-6);
  assert.ok(Math.abs(Number(match[2]) - expectedY) < 1e-6);
});

test("every covered jurisdiction ships a non-empty outline and the placeholder stays small", async () => {
  const { default: registry } = await import("../../data/countries.json", { with: { type: "json" } });
  const { default: outlines } = await import("../../data/country-outlines.json", {
    with: { type: "json" },
  });
  const keys = Object.keys(outlines.countries);
  assert.ok(keys.length >= 12);
  for (const key of keys) {
    const svg = buildOpportunityLocatorPlaceholderSvg({
      authorityName: "",
      jurisdictionKey: key,
      jurisdictionLabel: key,
      locationLabel: null,
      title: "",
    });
    assert.match(svg, /id="country-outline"/);
  }
  // Every country in the registry that the atlas can draw has an outline, so no record falls back
  // to a bare grid for want of one.
  assert.deepEqual(
    Object.entries(registry.countries)
      .filter(([, entry]) => (entry as { atlasName?: string }).atlasName)
      .map(([key]) => key)
      .filter((key) => !(key in outlines.countries)),
    [],
  );
  assert.ok(JSON.stringify(outlines).length < 450_000, "outline data for every country stays below the 756 KB atlas it replaces");
});

test("hyphenated and underscored jurisdiction keys resolve to the same outline", () => {
  const input = { authorityName: "", jurisdictionLabel: "United Kingdom", locationLabel: null, title: "" };
  const a = buildOpportunityLocatorPlaceholderSvg({ ...input, jurisdictionKey: "united-kingdom" });
  const b = buildOpportunityLocatorPlaceholderSvg({ ...input, jurisdictionKey: "united_kingdom" });
  assert.match(a, /id="country-outline"/);
  assert.match(b, /id="country-outline"/);
});

test("the placeholder carries a dark palette so it follows the page's colour scheme", () => {
  const svg = buildOpportunityLocatorPlaceholderSvg({
    authorityName: "Commune de Maur",
    jurisdictionKey: "switzerland",
    jurisdictionLabel: "Switzerland",
    locationLabel: "Maur",
    title: "Extension du complexe sportif",
  });
  // Colours come from classes, not from attributes, so the dark rules can replace them.
  assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
  // The card's drawing has its paper square (as a class, so the dark rule can replace it).
  assert.match(svg, /class="paper"/);
  assert.doesNotMatch(svg, /fill="#f4f2ea"/);
  assert.doesNotMatch(svg, /stroke="#21201b"/);
  // In the dark palette the card's paper is a step lighter than the dark page (#11110d), so the
  // card still stands apart from it.
  assert.match(svg, /@media \(prefers-color-scheme: dark\) \{[^}]*\.paper \{ fill: #24231e; \}/);
});

test("the inset map is the outline and one dot, and exists only for a position that is really known", () => {
  const base = {
    authorityName: "Commune de Maur",
    jurisdictionKey: "switzerland",
    jurisdictionLabel: "Switzerland",
    locationLabel: "Maur",
    title: "Extension du complexe sportif",
  };
  const inset = buildOpportunityLocatorInsetSvg({ ...base, geoLat: 47.3407, geoLng: 8.671 });
  assert.ok(inset);
  // One dot, and no backing at all: it sits over a photograph, in fixed light strokes.
  assert.equal((inset.match(/<circle /g) ?? []).length, 1);
  assert.doesNotMatch(inset, /<rect|class="paper"|locator-grid|<text|prefers-color-scheme/);
  // A dark casing under the light stroke keeps the outline readable on pale imagery too.
  assert.match(inset, /<path d="[^"]+" fill="none" stroke="#0e1813"/);
  assert.match(inset, /<path d="[^"]+" fill="#f3f1e6"/);

  assert.equal(buildOpportunityLocatorInsetSvg(base), null, "no coordinates, no dot");
  assert.equal(buildOpportunityLocatorInsetSvg({ ...base, jurisdictionKey: "atlantis", geoLat: 1, geoLng: 1 }), null);
  assert.equal(buildOpportunityLocatorInsetSvg(null), null);
});

