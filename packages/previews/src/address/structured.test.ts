import assert from "node:assert/strict";
import test from "node:test";

import { extractStructuredAddressCandidatesFromHtml } from "./structured";

test("extractStructuredAddressCandidatesFromHtml reads precise address from blocked-page meta tags", () => {
  const candidates = extractStructuredAddressCandidatesFromHtml(`
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
  const candidates = extractStructuredAddressCandidatesFromHtml(`
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
