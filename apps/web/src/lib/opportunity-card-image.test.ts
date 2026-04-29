import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRelatedPreviewPageUrlsFromJsonPayload,
  resolvePreviewImageUrlFromHtml,
} from "./opportunity-card-image";

test("resolvePreviewImageUrlFromHtml skips logos and placeholders in favor of richer images", () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="/assets/logo.png" />
      </head>
      <body>
        <img src="/img/user-placeholder.jpg" alt="User Image" class="user-profile-pic" />
        <picture>
          <source
            media="(min-width: 1200px)"
            srcset="/media/project-cover-1600.jpg 1600w, /media/project-cover-800.jpg 800w"
          />
          <img src="/media/project-cover-800.jpg" alt="Project hero image" width="800" height="450" />
        </picture>
      </body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(html, "https://example.com/opportunity");
  assert.equal(imageUrl, "https://example.com/media/project-cover-1600.jpg");
});

test("resolvePreviewImageUrlFromHtml can fall back to json-ld images when inline images are junk", () => {
  const html = `
    <html>
      <body>
        <img src="/img/crown_copyright.png" alt="" width="125" height="102" />
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Article",
            "image": {
              "@type": "ImageObject",
              "url": "/uploads/project-render.webp",
              "width": 1400,
              "height": 900
            }
          }
        </script>
      </body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(html, "https://example.com/opportunity");
  assert.equal(imageUrl, "https://example.com/uploads/project-render.webp");
});

test("resolvePreviewImageUrlFromHtml returns null when only site chrome images exist", () => {
  const html = `
    <html>
      <body>
        <img src="/static/header-logo.svg" alt="Site logo" class="header-logo" />
        <img src="/static/busy_indicator.gif" alt="Loading Data" class="app-loading-spinner" />
      </body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(html, "https://example.com/opportunity");
  assert.equal(imageUrl, null);
});

test("resolvePreviewImageUrlFromHtml blocks NetServer portal chrome imagery", () => {
  const html = `
    <html>
      <head>
        <meta
          property="og:image"
          content="https://vergabe.duesseldorf.de/NetServer/_images/img/csm_csm_Wappen_DUS_a0ecf34a9d_0890e3955f_05acf90711.jpg"
        />
      </head>
      <body></body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(html, "https://vergabe.duesseldorf.de/NetServer/index.jsp");
  assert.equal(imageUrl, null);
});

test("resolvePreviewImageUrlFromHtml blocks RIB platform icons", () => {
  const html = `
    <html>
      <body>
        <img src="/img/platforms/obb-32x32.png" alt="Vergabeplattform Bayern" />
      </body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(html, "https://meinauftrag.rib.de/public/publications/123");
  assert.equal(imageUrl, null);
});

test("resolvePreviewImageUrlFromHtml blocks RIB browser-upgrade chrome images", () => {
  const html = `
    <html>
      <body>
        <img src="/img/browser/chrome.png" alt="" />
      </body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(html, "https://meinauftrag.rib.de/public/publications/123");
  assert.equal(imageUrl, null);
});

test("resolvePreviewImageUrlFromHtml prefers Konkurado competition imagery over portal logos", () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="https://konkurado.ch//storage/competitions/105476/Luftbild_Perimeter_1775739298.jpg" />
      </head>
      <body>
        <img src="https://konkurado.ch/logo/konkurado_logo.svg" alt="Konkurado logo" />
        <img src="/thumbs/2000x2000/competitions/105476/Luftbild_Perimeter_1775739298.jpg" alt="Wettbewerb Herbstweg" />
      </body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(html, "https://konkurado.ch/de/ws-herbstweg");
  assert.equal(
    imageUrl,
    "https://konkurado.ch/thumbs/2000x2000/competitions/105476/Luftbild_Perimeter_1775739298.jpg",
  );
});

test("resolvePreviewImageUrlFromHtml ignores Hamburg teaser logos outside the article body", () => {
  const html = `
    <html>
      <body>
        <div class="km1-text-opener">
          <div class="km1-article-intro">
            <span class="km1-topline">GMH | Gebäudemanagement Hamburg</span>
            <h1 class="km1-heading km1-article__heading">Julius-Ludowieg Straße</h1>
            <div class="km1-richtext">
              <p>Die vollständigen Ausschreibungsunterlagen stehen im Bieterportal zur Verfügung.</p>
            </div>
          </div>
        </div>
        <div class="km1-teaser-row">
          <picture>
            <source srcset="/resource/image/1111892/landscape_ratio16x9/400/225/finanzbehoerde-schulbau-hh-rgb-logo.png" />
            <img src="/resource/image/1111892/landscape_ratio16x9/400/225/finanzbehoerde-schulbau-hh-rgb-logo.png" alt="Schulbau Hamburg logo" />
          </picture>
        </div>
      </body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(
    html,
    "https://www.hamburg.de/politik-und-verwaltung/ausschreibungen/example",
  );
  assert.equal(imageUrl, null);
});

test("resolvePreviewImageUrlFromHtml uses attachment-first handling for attachment-only procurement portals", () => {
  const html = `
    <html>
      <body>
        <a href="/documents/project-hero.webp" class="attachment-link">Anteprima progetto</a>
        <img src="https://cdn-aws.digitalpa.it/pacman/default/1.9.0/img/logo-horizontal.svg" alt="logo" />
      </body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(
    html,
    "https://cultura-sardegna.acquistitelematici.it/tender-esiti/dettaglio/597",
  );
  assert.equal(imageUrl, "https://cultura-sardegna.acquistitelematici.it/documents/project-hero.webp");
});

test("resolvePreviewImageUrlFromHtml accepts signed download links when the link label names an image", () => {
  const html = `
    <html>
      <body>
        <a
          href="/download?token=abc123"
          title="Projektansicht"
          aria-label="Aussenperspektive"
        >
          HPS-Volketswil_Rendering.jpg
        </a>
      </body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(
    html,
    "https://vergabe.digitalpa.it/tender/dettaglio/123",
  );
  assert.equal(imageUrl, "https://vergabe.digitalpa.it/download?token=abc123");
});

test("resolvePreviewImageUrlFromHtml returns null for conservative placeholder hosts with no explicit image attachment", () => {
  const html = `
    <html>
      <body>
        <img src="./assets/images/busy_indicator.gif" alt="Loading" />
      </body>
    </html>
  `;

  const imageUrl = resolvePreviewImageUrlFromHtml(
    html,
    "https://portal.us.bn.cloud.ariba.com/dashboard/public/appext/comsapsbncdiscoveryui#/RfxEvent/preview/1110010514?anId=ANONYMOUS",
  );
  assert.equal(imageUrl, null);
});

test("extractRelatedPreviewPageUrlsFromJsonPayload returns SIMAP related portal URLs", () => {
  const payload = JSON.stringify({
    "project-info": {
      documentsSourceNote: {
        de: "Die Unterlagen können über www.planzeit.ch/de/downloads/ heruntergeladen werden.",
      },
      offerDigitalExternalPlatformUrl: "https://portal.example.com/tender/42",
      documentsSourceUrl: {
        de: "https://docs.example.com/project/42",
      },
    },
  });

  const relatedUrls = extractRelatedPreviewPageUrlsFromJsonPayload(payload, "https://www.simap.ch/api/project/42");
  assert.deepEqual(relatedUrls, [
    "https://www.planzeit.ch/de/downloads/",
    "https://portal.example.com/tender/42",
    "https://docs.example.com/project/42",
  ]);
});
