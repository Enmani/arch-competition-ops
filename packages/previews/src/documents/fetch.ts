// Fetch notice pages and PDFs through the SSRF-guarded fetcher, under the per-record budget.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RunBudget } from "../net/budget";
import type { SafeFetcher } from "../net/safe-fetch";
import { isPdfLikeUrl } from "./urls";

export type DocumentContext = {
  budget: RunBudget;
  fetcher: SafeFetcher;
};

export type HtmlDocument = {
  html: string;
  /** False for error pages (403 and friends): their meta tags can still carry an address. */
  ok: boolean;
  url: string;
};

const HTML_TIMEOUT_MS = 7000;
const HTML_MAX_BYTES = 3 * 1024 * 1024;
const PDF_TIMEOUT_MS = 12_000;
const PDF_MAX_BYTES = 12 * 1024 * 1024;
const PDF_TEXT_TIMEOUT_MS = 15_000;
const PDF_TEXT_MAX_BUFFER = 512 * 1024;

export const fetchHtmlDocument = async (
  { budget, fetcher }: DocumentContext,
  url: string,
): Promise<HtmlDocument | null> => {
  if (!budget.spend()) {
    return null;
  }
  const result = await fetcher(url, {
    accept: "text/html,application/xhtml+xml",
    maxBytes: HTML_MAX_BYTES,
    timeoutMs: Math.min(HTML_TIMEOUT_MS, budget.remainingMs()),
  });
  if (!result?.contentType.includes("text/html")) {
    return null;
  }
  return {
    html: result.body.toString("utf8"),
    ok: result.status >= 200 && result.status < 300,
    url: result.url,
  };
};

/** First pages of a PDF as text, via poppler's `pdftotext` (no shell, fixed arguments). */
export const extractTextFromPdfBuffer = async (payload: Buffer): Promise<string | null> => {
  let directory: string | null = null;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "arch-competition-ops-pdf-"));
    const pdfPath = path.join(directory, "source.pdf");
    await writeFile(pdfPath, payload);
    return await new Promise<string | null>((resolve) => {
      execFile(
        "pdftotext",
        ["-q", "-f", "1", "-l", "3", "-enc", "UTF-8", "-nopgbrk", pdfPath, "-"],
        { encoding: "utf8", maxBuffer: PDF_TEXT_MAX_BUFFER, timeout: PDF_TEXT_TIMEOUT_MS },
        (error, stdout) => {
          resolve(error || typeof stdout !== "string" || stdout.trim() === "" ? null : stdout);
        },
      );
    });
  } catch {
    return null;
  } finally {
    if (directory) {
      await rm(directory, { force: true, recursive: true }).catch(() => undefined);
    }
  }
};

export const fetchPdfText = async (
  { budget, fetcher }: DocumentContext,
  url: string,
): Promise<string | null> => {
  if (!budget.spend()) {
    return null;
  }
  const result = await fetcher(url, {
    accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    maxBytes: PDF_MAX_BYTES,
    timeoutMs: Math.min(PDF_TIMEOUT_MS, budget.remainingMs()),
  });
  if (!result || result.status < 200 || result.status >= 300 || result.body.length === 0) {
    return null;
  }
  if (!result.contentType.includes("pdf") && !isPdfLikeUrl(result.url)) {
    return null;
  }
  return extractTextFromPdfBuffer(result.body);
};
