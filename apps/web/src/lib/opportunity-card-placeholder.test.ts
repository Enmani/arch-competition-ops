import assert from "node:assert/strict";
import test from "node:test";

import { buildOpportunityLocatorPlaceholderSvg } from "./opportunity-card-placeholder";

test("buildOpportunityLocatorPlaceholderSvg renders a jurisdiction code and city label", () => {
  const svg = buildOpportunityLocatorPlaceholderSvg({
    authorityName: "Commune de Lausanne",
    jurisdictionKey: "switzerland",
    jurisdictionLabel: "Switzerland",
    title: "Concorso, 1005 Lausanne",
  });

  assert.match(svg, />CH</);
  assert.match(svg, /LAUSANNE/);
  assert.match(svg, /SWITZERLAND/);
  assert.match(svg, /id="country-outline"/);
  assert.match(svg, /data-outline-source="world-atlas"/);
  assert.match(svg, /data-country-key="switzerland"/);
});

test("buildOpportunityLocatorPlaceholderSvg falls back to a neutral OPS code", () => {
  const svg = buildOpportunityLocatorPlaceholderSvg();

  assert.match(svg, />OPS</);
  assert.doesNotMatch(svg, /id="country-outline"/);
  assert.doesNotMatch(svg, /<\/text>\s*<text x="82" y="610"/);
});
