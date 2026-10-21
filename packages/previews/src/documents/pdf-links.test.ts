import assert from "node:assert/strict";
import test from "node:test";

import { extractPdfUrlsFromHtml } from "./pdf-links";

test("extractPdfUrlsFromHtml resolves relative and absolute pdf attachments", () => {
  const urls = extractPdfUrlsFromHtml(
    `
      <html>
        <body>
          <a href="/files/memoria.pdf">Memoria</a>
          <a href="https://example.org/docs/plans.pdf?download=1">Plans</a>
          <a href="mailto:test@example.org">Mail</a>
          <iframe src="./annex/specification.pdf"></iframe>
        </body>
      </html>
    `,
    "https://procurement.example.org/notices/123",
  );

  assert.deepEqual(urls, [
    "https://procurement.example.org/files/memoria.pdf",
    "https://example.org/docs/plans.pdf?download=1",
    "https://procurement.example.org/notices/annex/specification.pdf",
  ]);
});

test("extractPdfUrlsFromHtml reads script-embedded project attachments and filters legal pdf noise", () => {
  const urls = extractPdfUrlsFromHtml(
    `
      <html>
        <body>
          <script>
            var documentsAttachments = [{
              "rows":[
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=abc123\\">Project_Brief.pdf<\\/a>"}]},
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/pdf\\/de\\/rib-itwo-tender-nutzungsbedingungen-08-2023.pdf\\">Terms<\\/a>"}]}
              ]
            }];
          </script>
        </body>
      </html>
    `,
    "https://procurement.example.org/notices/123",
  );

  assert.deepEqual(urls, ["https://procurement.example.org/remote/download.php?k=abc123"]);
});

test("extractPdfUrlsFromHtml ranks site-plan style attachments ahead of generic forms", () => {
  const urls = extractPdfUrlsFromHtml(
    `
      <html>
        <body>
          <script>
            var documentsAttachments = [{
              "rows":[
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=form001\\">Teilnahmeantrag.pdf<\\/a>"}]},
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=plan001\\">Amtlicher Lageplan.pdf<\\/a>"}]},
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=brief001\\">Leistungsbeschreibung.pdf<\\/a>"}]}
              ]
            }];
          </script>
        </body>
      </html>
    `,
    "https://procurement.example.org/notices/123",
  );

  assert.deepEqual(urls, [
    "https://procurement.example.org/remote/download.php?k=plan001",
    "https://procurement.example.org/remote/download.php?k=brief001",
    "https://procurement.example.org/remote/download.php?k=form001",
  ]);
});

test("extractPdfUrlsFromHtml ranks escaped script attachment titles instead of hash urls", () => {
  const urls = extractPdfUrlsFromHtml(
    `
      <html>
        <body>
          <script>
            var documentsAttachments = [{
              "rows":[
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=form001\\">Teilnahmeantrag.pdf<\\/a>"}]},
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=plan001\\">Amtlicher Lageplan.pdf<\\/a>"}]},
                {"data":[{"value":"<a target=\\"_blank\\" href=\\"https:\\/\\/procurement.example.org\\/remote\\/download.php?k=brief001\\">Leistungsbeschreibung.pdf<\\/a>"}]}
              ]
            }];
          </script>
        </body>
      </html>
    `,
    "https://procurement.example.org/notices/123",
  );

  assert.deepEqual(urls, [
    "https://procurement.example.org/remote/download.php?k=plan001",
    "https://procurement.example.org/remote/download.php?k=brief001",
    "https://procurement.example.org/remote/download.php?k=form001",
  ]);
});
