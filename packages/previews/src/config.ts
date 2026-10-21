// Runtime configuration of the preview generator, read from the environment on demand (never at
// import time) so tests and the CLI control it explicitly. Variable names are the repo-wide
// contract documented in .env.example; the old BAIDU_MAPS_AK style aliases are still read.

export const PREVIEW_PROJECT_NAME = "arch-competition-ops-previews";

export type PreviewConfig = {
  /** Contact address sent in the User-Agent, as the Nominatim/Photon usage policies require. */
  contact: string;
  userAgent: string;
  nominatimUrl: string;
  photonUrl: string;
  baiduUrl: string;
  baiduAk: string;
  baiduSk: string;
  amapUrl: string;
  amapKey: string;
  tileUrlTemplate: string;
  /** Text rendered onto every satellite image and stored in the manifest. */
  tileAttribution: string;
  debug: boolean;
};

const pick = (env: NodeJS.ProcessEnv, ...names: string[]) => {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
};

export const DEFAULT_TILE_URL_TEMPLATE =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/** Esri's required credit line for World Imagery. Overridable together with the tile URL. */
export const DEFAULT_TILE_ATTRIBUTION =
  "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community";

export const loadPreviewConfig = (env: NodeJS.ProcessEnv = process.env): PreviewConfig => {
  const contact = pick(env, "ARCH_PREVIEW_CONTACT") || "contact-unset";
  return {
    amapKey: pick(env, "ARCH_SATELLITE_AMAP_KEY", "AMAP_MAPS_KEY"),
    amapUrl: pick(env, "ARCH_SATELLITE_AMAP_GEOCODER_URL") || "https://restapi.amap.com/v3/geocode/geo",
    baiduAk: pick(env, "ARCH_SATELLITE_BAIDU_AK", "BAIDU_MAPS_AK"),
    baiduSk: pick(env, "ARCH_SATELLITE_BAIDU_SK", "BAIDU_MAPS_SK"),
    baiduUrl:
      pick(env, "ARCH_SATELLITE_BAIDU_GEOCODER_URL") || "https://api.map.baidu.com/geocoding/v3/",
    contact,
    debug: env.ARCH_SATELLITE_DEBUG === "1",
    nominatimUrl:
      pick(env, "ARCH_SATELLITE_GEOCODER_URL") || "https://nominatim.openstreetmap.org/search",
    photonUrl: pick(env, "ARCH_SATELLITE_PHOTON_URL") || "https://photon.komoot.io/api",
    tileAttribution: pick(env, "ARCH_PREVIEW_TILE_ATTRIBUTION") || DEFAULT_TILE_ATTRIBUTION,
    tileUrlTemplate: pick(env, "ARCH_SATELLITE_TILE_URL_TEMPLATE") || DEFAULT_TILE_URL_TEMPLATE,
    // An honest identification: project name and a way to reach the operator. No browser
    // impersonation (audit P6: the old code claimed to be Chrome).
    userAgent: `${PREVIEW_PROJECT_NAME}/0.1 (+contact: ${contact})`,
  };
};

export const hasConfiguredContact = (config: PreviewConfig) => config.contact !== "contact-unset";
