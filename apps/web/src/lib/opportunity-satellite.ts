/**
 * The satellite image of a card, fetched only when someone points at it. The same URL answers
 * with the prebuilt image when there is one and with the drawn locator when there is not; the
 * `x-arch-image-source` header says which, so a card without a satellite does nothing on hover.
 * The imagery credit comes in `x-arch-image-attribution` (it is not drawn into the picture).
 *
 * One request per image per visit (the browser cache covers later visits). Only the small JPEG
 * is kept; a decoded bitmap is made per hover and released, so a long session does not pile up
 * megabytes of pixels.
 */
export type Satellite = { attribution: string | null; blob: Blob };

const requests = new Map<string, Promise<Satellite | null>>();

const readAttribution = (value: string | null) => {
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export const loadSatellite = (url: string): Promise<Satellite | null> => {
  let request = requests.get(url);
  if (!request) {
    request = fetch(url)
      .then(async (response) =>
        response.ok && response.headers.get("x-arch-image-source") === "asset"
          ? { attribution: readAttribution(response.headers.get("x-arch-image-attribution")), blob: await response.blob() }
          : null,
      )
      .catch(() => {
        requests.delete(url);
        return null;
      });
    requests.set(url, request);
  }
  return request;
};
