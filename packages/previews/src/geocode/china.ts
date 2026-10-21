// Chinese coordinate systems (BD-09, GCJ-02) and Baidu/Amap helpers.
import { createHash } from "node:crypto";

import { normalizeJurisdictionKey } from "../text/normalize";
import type { PreviewOpportunity } from "../types";

export const parseFiniteCoordinate = (value: number | string | null | undefined) => {
  const numericValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numericValue) ? numericValue : null;
};

/** Baidu signs requests with an MD5 over the path, query and the account secret (`sk`). */
export const buildBaiduSignedUrl = (baseUrl: string, params: URLSearchParams, sk = "") => {
  const url = new URL(baseUrl);
  const requestPath = url.pathname || "/";
  const unsignedQuery = params.toString();
  if (!sk) {
    return `${baseUrl}?${unsignedQuery}`;
  }

  const rawSignature = `${requestPath}?${unsignedQuery}${sk}`;
  const encodedSignatureSeed = encodeURIComponent(rawSignature);
  const sn = createHash("md5").update(encodedSignatureSeed).digest("hex");
  return `${baseUrl}?${unsignedQuery}&sn=${sn}`;
};

export const isChinaJurisdiction = (opportunity: PreviewOpportunity) =>
  normalizeJurisdictionKey(opportunity.jurisdictionKey) === "china";

export const degreesToRadians = (value: number) => value * (Math.PI / 180);

export const chinaCoordinateTransformLat = (
  lngOffset: number,
  latOffset: number,
) => {
  let result =
    -100 +
    2 * lngOffset +
    3 * latOffset +
    0.2 * latOffset * latOffset +
    0.1 * lngOffset * latOffset +
    0.2 * Math.sqrt(Math.abs(lngOffset));
  result +=
    ((20 * Math.sin(6 * lngOffset * Math.PI) + 20 * Math.sin(2 * lngOffset * Math.PI)) * 2) /
    3;
  result +=
    ((20 * Math.sin(latOffset * Math.PI) + 40 * Math.sin((latOffset / 3) * Math.PI)) * 2) / 3;
  result +=
    ((160 * Math.sin((latOffset / 12) * Math.PI) + 320 * Math.sin((latOffset * Math.PI) / 30)) *
      2) /
    3;
  return result;
};

export const chinaCoordinateTransformLng = (
  lngOffset: number,
  latOffset: number,
) => {
  let result =
    300 +
    lngOffset +
    2 * latOffset +
    0.1 * lngOffset * lngOffset +
    0.1 * lngOffset * latOffset +
    0.1 * Math.sqrt(Math.abs(lngOffset));
  result +=
    ((20 * Math.sin(6 * lngOffset * Math.PI) + 20 * Math.sin(2 * lngOffset * Math.PI)) * 2) /
    3;
  result +=
    ((20 * Math.sin(lngOffset * Math.PI) + 40 * Math.sin((lngOffset / 3) * Math.PI)) * 2) / 3;
  result +=
    ((150 * Math.sin((lngOffset / 12) * Math.PI) + 300 * Math.sin((lngOffset / 30) * Math.PI)) *
      2) /
    3;
  return result;
};

export const isOutsideChina = (lat: number, lng: number) =>
  lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;

export const gcj02ToWgs84 = (lat: number, lng: number) => {
  if (isOutsideChina(lat, lng)) {
    return { lat, lng };
  }

  const a = 6378245;
  const ee = 0.00669342162296594323;
  const lngOffset = lng - 105;
  const latOffset = lat - 35;
  let deltaLat = chinaCoordinateTransformLat(lngOffset, latOffset);
  let deltaLng = chinaCoordinateTransformLng(lngOffset, latOffset);
  const radLat = degreesToRadians(lat);
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  deltaLat =
    (deltaLat * 180) /
    (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  deltaLng =
    (deltaLng * 180) /
    ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);

  return {
    lat: lat - deltaLat,
    lng: lng - deltaLng,
  };
};

export const bd09ToGcj02 = (lat: number, lng: number) => {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000 / 180);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000 / 180);
  return {
    lat: z * Math.sin(theta),
    lng: z * Math.cos(theta),
  };
};

export const bd09ToWgs84 = (lat: number, lng: number) => {
  const gcj02 = bd09ToGcj02(lat, lng);
  return gcj02ToWgs84(gcj02.lat, gcj02.lng);
};
