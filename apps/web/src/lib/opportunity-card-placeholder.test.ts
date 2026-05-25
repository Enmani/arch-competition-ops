import assert from "node:assert/strict";
import test from "node:test";

import { buildOpportunityLocatorPlaceholderSvg } from "./opportunity-card-placeholder";

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
