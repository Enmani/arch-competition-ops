// Bounded, SSRF-guarded GET for third-party documents (notice pages, PDFs, official images).
//
// Why node:http(s) and not fetch: the guard must run at connect time. A custom `lookup` sees the
// addresses the connection will really use, which closes the DNS-rebinding window that a
// resolve-then-fetch check leaves open. Redirects are followed by hand, each hop re-validated and
// counted. The body is capped while streaming, so a hostile server cannot make us buffer it.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import zlib from "node:zlib";

import { isPrivateAddress, parsePublicHttpUrl, UnsafeUrlError } from "./ssrf";

export type SafeFetchOptions = {
  accept: string;
  /** Hard cap on the (decompressed) body. Larger responses are abandoned, not truncated. */
  maxBytes: number;
  /** Wall-clock limit for the whole call, redirects included. */
  timeoutMs: number;
  maxRedirects?: number;
};

export type SafeFetchResult = {
  body: Buffer;
  contentType: string;
  /** Final URL after redirects. */
  url: string;
  status: number;
};

export type SafeFetcher = (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult | null>;

export type SafeFetcherConfig = {
  userAgent: string;
  /** Test seam: replaces dns.lookup. */
  lookup?: typeof dns.lookup;
  /** Tests only: lets the fetcher talk to a loopback server. Never set in production code. */
  allowPrivateNetworks?: boolean;
  /** Receives a short diagnostic when a fetch is refused or fails (URL without query string). */
  onEvent?: (event: string, details: Record<string, unknown>) => void;
};

const redactUrl = (value: string) => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
};

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

const decoderFor = (encoding: string | undefined) => {
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
};

export const createGuardedLookup =
  (lookup: typeof dns.lookup, allowPrivate: boolean): LookupFunction =>
  (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const list = addresses as dns.LookupAddress[];
      if (!allowPrivate && list.some((entry) => isPrivateAddress(entry.address))) {
        callback(new UnsafeUrlError("private-address", hostname), "", 0);
        return;
      }
      if (options.all) {
        (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
        return;
      }
      callback(null, list[0].address, list[0].family);
    });
  };

type RawResponse = { response: http.IncomingMessage; request: http.ClientRequest };

export const createSafeFetcher = ({
  userAgent,
  lookup = dns.lookup,
  allowPrivateNetworks = false,
  onEvent,
}: SafeFetcherConfig): SafeFetcher => {
  const guardedLookup = createGuardedLookup(lookup, allowPrivateNetworks);

  const open = (url: URL, accept: string, signal: AbortSignal): Promise<RawResponse> =>
    new Promise((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      const request = transport.request(
        url,
        {
          agent: false,
          headers: {
            accept,
            "accept-encoding": "gzip, deflate, br",
            "accept-language": "en;q=0.9, *;q=0.5",
            "user-agent": userAgent,
          },
          lookup: guardedLookup,
          method: "GET",
          signal,
        },
        (response) => resolve({ request, response }),
      );
      request.on("error", reject);
      request.end();
    });

  const readCapped = (response: http.IncomingMessage, maxBytes: number) =>
    new Promise<Buffer | null>((resolve) => {
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy();
        resolve(null);
        return;
      }

      const decoder = decoderFor(response.headers["content-encoding"] as string | undefined);
      const source = decoder ? response.pipe(decoder) : response;
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (value: Buffer | null) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      source.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy();
          decoder?.destroy();
          finish(null);
          return;
        }
        chunks.push(chunk);
      });
      source.on("end", () => finish(Buffer.concat(chunks)));
      source.on("error", () => finish(null));
      response.on("error", () => finish(null));
      response.on("aborted", () => finish(null));
    });

  return async (rawUrl, { accept, maxBytes, maxRedirects = 5, timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let current = allowPrivateNetworks ? new URL(rawUrl) : parsePublicHttpUrl(rawUrl);
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        const { response } = await open(current, accept, controller.signal);
        const status = response.statusCode ?? 0;
        const location = response.headers.location;

        if (redirectStatuses.has(status) && location) {
          response.resume();
          const next = new URL(location, current);
          current = allowPrivateNetworks && /^https?:$/.test(next.protocol)
            ? next
            : parsePublicHttpUrl(next);
          continue;
        }

        const body = await readCapped(response, maxBytes);
        if (!body) {
          return null;
        }
        return {
          body,
          contentType: String(response.headers["content-type"] ?? "").toLowerCase(),
          status,
          url: current.href,
        };
      }
      return null; // too many redirects
    } catch (error) {
      // Blocked URL, DNS/connect failure or abort: the caller treats all of them as "no document".
      onEvent?.("document-fetch-failed", {
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        url: redactUrl(rawUrl),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
};
