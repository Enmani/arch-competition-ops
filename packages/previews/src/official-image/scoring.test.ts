import assert from "node:assert/strict";
import test from "node:test";

import { resolvePreviewImageUrlFromHtml } from "./scoring";

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
