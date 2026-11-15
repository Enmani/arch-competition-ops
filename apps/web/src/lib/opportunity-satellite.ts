/**
 * The satellite image of a card, fetched only when someone points at it. The same URL answers
 * with the prebuilt image when there is one and with the drawn locator when there is not; the
 * `x-arch-image-source` header says which, so a card without a satellite does nothing on hover.
 * One request per card per visit (the browser cache covers later visits). Only the small JPEG
 * is kept; a decoded bitmap is made per hover and released, so a long session does not pile up
 * megabytes of pixels.
 */
const requests = new Map<string, Promise<Blob | null>>();

export const loadSatellite = (url: string): Promise<Blob | null> => {
  let request = requests.get(url);
  if (!request) {
    request = fetch(url)
      .then(async (response) =>
        response.ok && response.headers.get("x-arch-image-source") === "asset" ? response.blob() : null,
      )
      .catch(() => {
        requests.delete(url);
        return null;
      });
    requests.set(url, request);
  }
  return request;
};
