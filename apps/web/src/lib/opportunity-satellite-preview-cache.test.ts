import assert from "node:assert/strict";
import test from "node:test";

import {
  getSatellitePreviewStaticAssetPaths,
  getSatellitePreviewStaticFileName,
  getSatellitePreviewStaticFileNameCandidates,
} from "./opportunity-satellite-preview-cache";
import { satellitePreviewRevision } from "./opportunity-preview-revision";

test("getSatellitePreviewStaticFileName uses the shared satellite preview revision hash", () => {
  const fileName = getSatellitePreviewStaticFileName("sample slug");

  assert.equal(fileName, `sample_slug_${satellitePreviewRevision}.jpg`);
});

test("getSatellitePreviewStaticFileNameCandidates returns hash-first candidates plus legacy version fallbacks", () => {
  const candidates = getSatellitePreviewStaticFileNameCandidates(
    "concesi-n-demanial-del-bar-cafeteria-del-edificio-multiusos-de-beniatjar-sito-en-la-calle-sant-roc-19__pcsp-syndicated-notices__2026-05-12",
  );

  assert.deepEqual(candidates, [
    `concesi-n-demanial-del-bar-cafeteria-del-edificio-multiusos-de-beniatjar-sito-en-la-calle-sant-roc-19__pcsp-syndicated-notices__2026-05-12_${satellitePreviewRevision}.jpg`,
    "concesi-n-demanial-del-bar-cafeteria-del-edificio-multiusos-de-beniatjar-sito-en-la-calle-sant-roc-19__pcsp-syndicated-notices__2026-05-12_v6.jpg",
    "concesi-n-demanial-del-bar-cafeteria-del-edificio-multiusos-de-beniatjar-sito-en-la-calle-sant-roc-19__pcsp-syndicated-notices__2026-05-12_v5.jpg",
    "concesi-n-demanial-del-bar-cafeteria-del-edificio-multiusos-de-beniatjar-sito-en-la-calle-sant-roc-19__pcsp-syndicated-notices__2026-05-12_v4.jpg",
    "concesi-n-demanial-del-bar-cafeteria-del-edificio-multiusos-de-beniatjar-sito-en-la-calle-sant-roc-19__pcsp-syndicated-notices__2026-05-12_v3.jpg",
    "concesi-n-demanial-del-bar-cafeteria-del-edificio-multiusos-de-beniatjar-sito-en-la-calle-sant-roc-19__pcsp-syndicated-notices__2026-05-12_v2.jpg",
    "concesi-n-demanial-del-bar-cafeteria-del-edificio-multiusos-de-beniatjar-sito-en-la-calle-sant-roc-19__pcsp-syndicated-notices__2026-05-12_v1.jpg",
    "concesi-n-demanial-del-bar-cafeteria-del-edificio-multiusos-de-beniatjar-sito-en-la-calle-sant-roc-19__pcsp-syndicated-notices__2026-05-12.jpg",
  ]);
});

test("getSatellitePreviewStaticAssetPaths mirrors fallback candidates under the public asset directory", () => {
  const assetPaths = getSatellitePreviewStaticAssetPaths("sample slug");

  assert.deepEqual(assetPaths, [
    `/opportunity-card-satellite/sample_slug_${satellitePreviewRevision}.jpg`,
    "/opportunity-card-satellite/sample_slug_v6.jpg",
    "/opportunity-card-satellite/sample_slug_v5.jpg",
    "/opportunity-card-satellite/sample_slug_v4.jpg",
    "/opportunity-card-satellite/sample_slug_v3.jpg",
    "/opportunity-card-satellite/sample_slug_v2.jpg",
    "/opportunity-card-satellite/sample_slug_v1.jpg",
    "/opportunity-card-satellite/sample_slug.jpg",
  ]);
});

test("getSatellitePreviewStaticFileNameCandidates falls back to legacy hashed file names", () => {
  const candidates = getSatellitePreviewStaticFileNameCandidates(
    "march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26_h27c1460be1",
  );

  assert.deepEqual(candidates, [
    `march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26_h27c1460be1_${satellitePreviewRevision}.jpg`,
    `march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26_${satellitePreviewRevision}.jpg`,
    "march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26_h27c1460be1.jpg",
    "march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26_v6.jpg",
    "march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26_v5.jpg",
    "march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26_v4.jpg",
    "march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26_v3.jpg",
    "march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26_v2.jpg",
    "march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26_v1.jpg",
    "march_-de-ma_trise-d-oeuvre-pour-l-op_ration-de-restructuration-et-extension-du-groupe-scolaire-de-no_-31__boamp-design-and-public-procurement-notices__2026-05-26.jpg",
  ]);
});
