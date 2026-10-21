import { HttpError } from "./http";

/**
 * CSRF defence for every state-changing request (POST/PUT/PATCH/DELETE): the request must
 * come from our own origin. SameSite=Lax cookies already block most cross-site POSTs; this
 * check is the second, explicit layer and also covers same-site-but-different-origin callers.
 *
 * Policy, in order:
 * 1. `Origin` present -> its host must equal the request host (scheme is ignored because TLS is
 *    terminated at the edge and the Worker may see http internally). Mismatch -> 403.
 * 2. `Origin` missing -> `Sec-Fetch-Site` `same-origin` or `none` (user-initiated) is accepted.
 * 3. Otherwise fall back to `Referer`, whose host must match.
 * 4. Nothing to verify -> 403. Browsers always send `Origin` on form posts and fetch() calls
 *    with a body, so refusing header-less requests only affects non-browser clients, and those
 *    do not carry the session cookie anyway.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const expectedHost = (request: Request) =>
  (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host)
    .split(",")[0]
    .trim()
    .toLowerCase();

const hostOf = (value: string) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    // An unparsable Origin/Referer never matches the host, so the request is rejected.
    return null;
  }
};

export const assertSameOrigin = (request: Request) => {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return;
  }

  const reject = () => new HttpError("csrf_rejected", "Cross-origin requests are not allowed.");
  const host = expectedHost(request);
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin === "null" || hostOf(origin) !== host) {
      throw reject();
    }
    return;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "none") {
    return;
  }
  if (fetchSite !== null) {
    throw reject();
  }

  const referer = request.headers.get("referer");
  if (referer && hostOf(referer) === host) {
    return;
  }
  throw reject();
};

const FORM_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);

/** Browser form posts only; anything else on form endpoints is a 415. */
export const assertFormRequest = (request: Request) => {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!FORM_TYPES.has(contentType)) {
    throw new HttpError("unsupported_media_type", "Content-Type must be a form encoding.");
  }
};
