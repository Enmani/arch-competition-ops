import assert from "node:assert/strict";
import test from "node:test";

import { extractRelatedPreviewPageUrlsFromJsonPayload } from "./related-pages";

test("extractRelatedPreviewPageUrlsFromJsonPayload returns SIMAP related portal URLs", () => {
  const payload = JSON.stringify({
    "project-info": {
      documentsSourceNote: {
        de: "Die Unterlagen können über www.planzeit.ch/de/downloads/ heruntergeladen werden.",
      },
      offerDigitalExternalPlatformUrl: "https://portal.example.com/tender/42",
      documentsSourceUrl: {
        de: "https://docs.example.com/project/42",
      },
    },
  });

  const relatedUrls = extractRelatedPreviewPageUrlsFromJsonPayload(payload, "https://www.simap.ch/api/project/42");
  assert.deepEqual(relatedUrls, [
    "https://www.planzeit.ch/de/downloads/",
    "https://portal.example.com/tender/42",
    "https://docs.example.com/project/42",
  ]);
});
