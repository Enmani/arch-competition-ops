/**
 * Absolute site origin for canonical, hreflang and Open Graph URLs.
 *
 * `SITE_URL` (a plain origin such as https://ops.example.com) wins. Without it the origin comes
 * from the request's Host header, which is attacker-controlled input: it is only accepted when
 * it looks like a hostname[:port], and the result is used for metadata only (never for
 * redirects, cookies or authorization). Set `SITE_URL` in production to remove the dependency.
 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;
const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

type OriginInput = {
  configured?: string | null;
  forwardedProto?: string | null;
  host?: string | null;
};

export const resolveSiteOrigin = ({ configured, forwardedProto, host }: OriginInput): string | null => {
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      // A malformed SITE_URL is ignored in favour of the request host.
    }
  }

  const candidate = host?.trim();
  if (!candidate || !HOST_PATTERN.test(candidate)) {
    return null;
  }
  const protocol = LOCAL_HOST_PATTERN.test(candidate)
    ? "http"
    : forwardedProto?.split(",")[0]?.trim() === "http"
      ? "http"
      : "https";
  return `${protocol}://${candidate.toLowerCase()}`;
};
