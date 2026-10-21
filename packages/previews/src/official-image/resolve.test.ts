import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { unlimitedBudget } from "../testing";
import type { SafeFetcher, SafeFetchResult } from "../net/safe-fetch";
import { fetchOfficialCardImage, isStadtZurichOpportunitySource } from "./resolve";

const page = (html: string, url: string): SafeFetchResult => ({
  body: Buffer.from(html),
  contentType: "text/html; charset=utf-8",
  status: 200,
  url,
});

const stubFetcher = (routes: Record<string, SafeFetchResult | null>) => {
  const requested: string[] = [];
  const fetcher: SafeFetcher = async (url) => {
    requested.push(url);
    return routes[url] ?? null;
  };
  return { fetcher, requested };
};

const input = {
  briefPdfUrl: null,
  documentsPortalUrl: null,
  officialUrl: "https://www.stadt-zuerich.ch/hochbau/de/index/projekt.html",
  sourceUrl: "https://www.simap.ch/project/1",
};

test("only Stadt Zuerich sources are eligible for an official image", () => {
  assert.equal(isStadtZurichOpportunitySource(input), true);
  assert.equal(
    isStadtZurichOpportunitySource({ ...input, officialUrl: "https://example.org/", sourceUrl: "https://example.org/x" }),
    false,
  );
  assert.equal(
    isStadtZurichOpportunitySource({ ...input, officialUrl: "https://evilstadt-zuerich.ch/", sourceUrl: null as never }),
    false,
    "a look-alike host does not match",
  );
});

test("other sources never trigger a fetch", async () => {
  const { fetcher, requested } = stubFetcher({});

  const result = await fetchOfficialCardImage(
    { budget: unlimitedBudget(), fetcher },
    { ...input, officialUrl: "https://example.org/", sourceUrl: "https://example.org/x" },
  );

  assert.equal(result, null);
  assert.deepEqual(requested, []);
});

test("the page image is downloaded, shrunk to a JPEG and credited to its host", async () => {
  const big = await sharp({ create: { background: "#446688", channels: 3, height: 1800, width: 2400 } })
    .png()
    .toBuffer();
  const { fetcher, requested } = stubFetcher({
    [input.officialUrl]: page(
      `<html><head><meta property="og:image" content="/media/hero-render.png"></head></html>`,
      input.officialUrl,
    ),
    "https://www.stadt-zuerich.ch/media/hero-render.png": {
      body: big,
      contentType: "image/png",
      status: 200,
      url: "https://www.stadt-zuerich.ch/media/hero-render.png",
    },
  });

  const result = await fetchOfficialCardImage({ budget: unlimitedBudget(), fetcher }, input);

  assert.ok(result);
  const metadata = await sharp(result.image).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(Math.max(metadata.width ?? 0, metadata.height ?? 0), 1200);
  assert.equal(result.attribution, "Image source: www.stadt-zuerich.ch");
  assert.ok(requested.includes("https://www.stadt-zuerich.ch/media/hero-render.png"));
});

test("an SVG or non-image answer for the picked URL is not accepted", async () => {
  const html = page(`<meta property="og:image" content="/media/hero-render.svg">`, input.officialUrl);
  for (const contentType of ["image/svg+xml", "text/html"]) {
    const { fetcher } = stubFetcher({
      [input.officialUrl]: html,
      "https://www.stadt-zuerich.ch/media/hero-render.svg": {
        body: Buffer.from("<svg/>"),
        contentType,
        status: 200,
        url: "https://www.stadt-zuerich.ch/media/hero-render.svg",
      },
    });
    assert.equal(await fetchOfficialCardImage({ budget: unlimitedBudget(), fetcher }, input), null, contentType);
  }
});

test("a SIMAP JSON notice leads to the related portal page that carries the image", async () => {
  const simapUrl = "https://www.simap.ch/api/project/1";
  const portal = "https://docs.example.org/project/1";
  const { fetcher, requested } = stubFetcher({
    [simapUrl]: {
      body: Buffer.from(JSON.stringify({ "project-info": { documentsSourceUrl: { de: portal } } })),
      contentType: "application/json",
      status: 200,
      url: simapUrl,
    },
    [portal]: page(`<meta property="og:image" content="https://docs.example.org/thumbs/1.jpg">`, portal),
  });

  const result = await fetchOfficialCardImage(
    { budget: unlimitedBudget(), fetcher },
    { ...input, officialUrl: "https://www.stadt-zuerich.ch/x", sourceUrl: simapUrl },
  );

  assert.equal(result, null, "no image bytes are served by the stub, but the related page was followed");
  assert.ok(requested.includes(portal));
  assert.ok(requested.includes("https://docs.example.org/thumbs/1.jpg"));
});
