import assert from "node:assert/strict";
import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import zlib from "node:zlib";

import { createGuardedLookup, createSafeFetcher } from "./safe-fetch";
import { UnsafeUrlError } from "./ssrf";

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;

const withServer = async (
  handler: Handler,
  run: (baseUrl: string, hits: () => number) => Promise<void>,
) => {
  let hits = 0;
  const server = http.createServer((request, response) => {
    hits += 1;
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, () => hits);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};

// Tests talk to a loopback server, so private networks are explicitly allowed for these fetchers.
const loopbackFetcher = () => createSafeFetcher({ allowPrivateNetworks: true, userAgent: "test-agent/1" });
const options = { accept: "*/*", maxBytes: 1024, timeoutMs: 2000 };

test("returns status, content type, final url and body, and identifies itself honestly", async () => {
  let seenAgent = "";
  await withServer(
    (request, response) => {
      seenAgent = String(request.headers["user-agent"]);
      response.writeHead(200, { "content-type": "Text/HTML; charset=utf-8" });
      response.end("<html>hello</html>");
    },
    async (baseUrl) => {
      const result = await loopbackFetcher()(`${baseUrl}/page`, options);
      assert.equal(result?.status, 200);
      assert.equal(result?.contentType, "text/html; charset=utf-8");
      assert.equal(result?.body.toString(), "<html>hello</html>");
      assert.equal(result?.url, `${baseUrl}/page`);
      assert.equal(seenAgent, "test-agent/1");
      assert.doesNotMatch(seenAgent, /Mozilla|Chrome/);
    },
  );
});

test("error pages are returned with their status so meta tags can still be read", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(403, { "content-type": "text/html" });
      response.end("blocked");
    },
    async (baseUrl) => {
      const result = await loopbackFetcher()(baseUrl, options);
      assert.equal(result?.status, 403);
    },
  );
});

test("follows redirects but gives up after the redirect cap", async () => {
  await withServer(
    (request, response) => {
      if (request.url === "/final") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("done");
        return;
      }
      const hop = Number(request.url?.slice(1) ?? 0);
      response.writeHead(302, { location: hop >= 3 ? "/final" : `/${hop + 1}` });
      response.end();
    },
    async (baseUrl) => {
      const ok = await loopbackFetcher()(`${baseUrl}/0`, { ...options, maxRedirects: 5 });
      assert.equal(ok?.body.toString(), "done");
      assert.equal(ok?.url, `${baseUrl}/final`);

      const capped = await loopbackFetcher()(`${baseUrl}/0`, { ...options, maxRedirects: 2 });
      assert.equal(capped, null);
    },
  );
});

test("a redirect to a non-http scheme is refused", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(302, { location: "file:///etc/passwd" });
      response.end();
    },
    async (baseUrl) => {
      assert.equal(await loopbackFetcher()(baseUrl, options), null);
    },
  );
});

test("a declared or streamed body above the byte cap is abandoned", async () => {
  await withServer(
    (request, response) => {
      if (request.url === "/declared") {
        response.writeHead(200, { "content-length": "100000", "content-type": "text/plain" });
        response.end("x".repeat(100000));
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" }); // chunked, no length
      response.write("x".repeat(600));
      response.write("x".repeat(600));
      response.end();
    },
    async (baseUrl) => {
      assert.equal(await loopbackFetcher()(`${baseUrl}/declared`, options), null);
      assert.equal(await loopbackFetcher()(`${baseUrl}/chunked`, options), null);
    },
  );
});

test("compressed bodies are inflated under the same cap (no decompression bombs)", async () => {
  await withServer(
    (request, response) => {
      const payload = zlib.gzipSync(request.url === "/bomb" ? "a".repeat(500_000) : "small");
      response.writeHead(200, { "content-encoding": "gzip", "content-type": "text/plain" });
      response.end(payload);
    },
    async (baseUrl) => {
      assert.equal((await loopbackFetcher()(`${baseUrl}/ok`, options))?.body.toString(), "small");
      assert.equal(await loopbackFetcher()(`${baseUrl}/bomb`, options), null);
    },
  );
});

test("a server that never answers is cut off by the timeout", async () => {
  await withServer(
    () => undefined,
    async (baseUrl) => {
      const started = Date.now();
      assert.equal(await loopbackFetcher()(baseUrl, { ...options, timeoutMs: 150 }), null);
      assert.ok(Date.now() - started < 1500);
    },
  );
});

test("private literals are refused before any connection is made", async () => {
  await withServer(
    (_request, response) => response.end("secret"),
    async (baseUrl, hits) => {
      const events: string[] = [];
      const guarded = createSafeFetcher({ onEvent: (event) => events.push(event), userAgent: "t" });
      assert.equal(await guarded(baseUrl, options), null);
      assert.equal(hits(), 0);
      assert.deepEqual(events, ["document-fetch-failed"]);
    },
  );
});

test("a public-looking host name that resolves to a private address is refused at connect time", async () => {
  const fakeLookup = (address: string) =>
    ((_hostname, lookupOptions, callback) => {
      const entries = [{ address, family: address.includes(":") ? 6 : 4 }];
      (lookupOptions as { all?: boolean }).all
        ? callback(null, entries as never, undefined as never)
        : callback(null, address as never, entries[0].family as never);
    }) as typeof dns.lookup;
  const resolve = (address: string, all: boolean) =>
    new Promise<{ error: Error | null; address: unknown }>((done) => {
      createGuardedLookup(fakeLookup(address), false)("rebind.example.org", { all }, ((
        error: Error | null,
        result: unknown,
      ) => done({ address: result, error })) as never);
    });

  for (const all of [true, false]) {
    const refused = await resolve("127.0.0.1", all);
    assert.ok(refused.error instanceof UnsafeUrlError);
    assert.equal((await resolve("169.254.169.254", all)).error instanceof UnsafeUrlError, true);
    assert.equal((await resolve("::1", all)).error instanceof UnsafeUrlError, true);
    assert.equal((await resolve("93.184.216.34", all)).error, null);
  }
  // The explicit test escape hatch is the only way to reach loopback.
  assert.equal((await new Promise<Error | null>((done) => {
    createGuardedLookup(fakeLookup("127.0.0.1"), true)("localhost", { all: true }, ((error: Error | null) =>
      done(error)) as never);
  })), null);
});
