import assert from "node:assert/strict";
import test from "node:test";

import { bd09ToWgs84, buildBaiduSignedUrl, gcj02ToWgs84 } from "./china";

test("gcj02ToWgs84 keeps china coordinates close while normalizing map provider output", () => {
  const converted = gcj02ToWgs84(39.908823, 116.39747);

  assert.ok(Math.abs(converted.lat - 39.9074) < 0.01);
  assert.ok(Math.abs(converted.lng - 116.3912) < 0.01);
});

test("bd09ToWgs84 keeps baidu coordinates close while normalizing map provider output", () => {
  const converted = bd09ToWgs84(39.915, 116.404);

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

  const url = buildBaiduSignedUrl(
    "https://api.map.baidu.com/geocoding/v3/",
    params,
  );

  assert.equal(
    url,
    "https://api.map.baidu.com/geocoding/v3/?address=%E9%BB%84%E5%86%88%E5%B8%88%E8%8C%83%E5%AD%A6%E9%99%A2%E4%B8%9C%E6%A0%A1%E5%8C%BA&ak=demo-ak&output=json&ret_coordtype=bd09ll",
  );
});

test("buildBaiduSignedUrl appends the MD5 signature when an SK is configured", () => {
  const params = new URLSearchParams({ address: "北京市", ak: "demo-ak", output: "json" });

  const signed = buildBaiduSignedUrl("https://api.map.baidu.com/geocoding/v3/", params, "demo-sk");

  const sn = new URL(signed).searchParams.get("sn");
  assert.match(sn ?? "", /^[0-9a-f]{32}$/);
  assert.equal(signed.startsWith("https://api.map.baidu.com/geocoding/v3/?address="), true);
  assert.notEqual(signed, buildBaiduSignedUrl("https://api.map.baidu.com/geocoding/v3/", params, "other-sk"));
});
