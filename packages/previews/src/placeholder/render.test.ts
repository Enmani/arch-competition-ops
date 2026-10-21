import assert from "node:assert/strict";
import test from "node:test";

import { buildOpportunityLocatorPlaceholderSvg } from "./render";

test("buildOpportunityLocatorPlaceholderSvg renders a jurisdiction code and city label", () => {
  const svg = buildOpportunityLocatorPlaceholderSvg({
    authorityName: "Commune de Lausanne",
    geoLat: null,
    geoLng: null,
    jurisdictionKey: "switzerland",
    jurisdictionLabel: "Switzerland",
    locationLabel: null,
    title: "Concorso, 1005 Lausanne",
  });

  assert.match(svg, />CH</);
  assert.match(svg, /LAUSANNE/);
  assert.match(svg, /SWITZERLAND/);
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

  assert.match(svg, /MAUR/);
  assert.match(svg, /data-marker-source="geo-coordinates"/);
  assert.doesNotMatch(svg, /translate\(345 290\)/);
});

test("buildOpportunityLocatorPlaceholderSvg falls back to a neutral OPS code", () => {
  const svg = buildOpportunityLocatorPlaceholderSvg();

  assert.match(svg, />OPS</);
  assert.doesNotMatch(svg, /id="country-outline"/);
  assert.doesNotMatch(svg, /<\/text>\s*<text x="82" y="610"/);
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
  assert.ok(JSON.stringify(outlines).length < 80_000, "outline data stays far below the 756 KB atlas");
});

test("hyphenated and underscored jurisdiction keys resolve to the same outline", () => {
  const input = { authorityName: "", jurisdictionLabel: "United Kingdom", locationLabel: null, title: "" };
  const a = buildOpportunityLocatorPlaceholderSvg({ ...input, jurisdictionKey: "united-kingdom" });
  const b = buildOpportunityLocatorPlaceholderSvg({ ...input, jurisdictionKey: "united_kingdom" });
  assert.match(a, /id="country-outline"/);
  assert.match(b, /id="country-outline"/);
});
