import assert from "node:assert/strict";
import test from "node:test";

import {
  isAcceptableAmapGeocodeResult,
  isAcceptableBaiduGeocodeResult,
  isAcceptableGeocodeResult,
  resolveChineseGeocodePrecision,
  resolveGeocodePrecision,
} from "./accept";

test("isAcceptableGeocodeResult accepts broader street-level square matches for circle overlays", () => {
  const accepted = isAcceptableGeocodeResult(
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
  const accepted = isAcceptableGeocodeResult(
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
  const accepted = isAcceptableGeocodeResult(
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
  const precision = resolveChineseGeocodePrecision(
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
  const accepted = isAcceptableBaiduGeocodeResult(
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
  const accepted = isAcceptableAmapGeocodeResult(
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

test("resolveGeocodePrecision marks broad municipal locality results as city precision", () => {
  const precision = resolveGeocodePrecision(
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
