// Collect location signals from an opportunity's pages and attached PDFs.
import {
  extractAddressCandidatesFromPdfText,
  extractAddressCandidatesFromText,
} from "../address/extract";
import { dedupeAddressCandidates } from "../address/compare";
import { extractStructuredAddressCandidatesFromHtml } from "../address/structured";
import { stripHtmlToText } from "../text/html";
import type {
  AddressCandidate,
  OpportunityPageLocationSignals,
  PreviewOpportunity,
} from "../types";
import { fetchHtmlDocument, fetchPdfText, type DocumentContext } from "./fetch";
import { extractPdfUrlsFromHtml } from "./pdf-links";
import { dedupeStringValues, isHtmlLikeUrl } from "./urls";

const MAX_PDF_URLS_PER_OPPORTUNITY = 3;

const sortedByScore = (scores: Map<string, number>) =>
  [...scores.entries()]
    .map(([url, score]) => ({ score, url }))
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));

export const fetchOpportunityPageLocationSignals = async (
  context: DocumentContext,
  opportunity: PreviewOpportunity,
): Promise<OpportunityPageLocationSignals> => {
  const pageUrls = dedupeStringValues([
    opportunity.officialUrl,
    opportunity.sourceUrl,
    opportunity.documentsPortalUrl,
  ]).filter((url) => isHtmlLikeUrl(url));
  const structuredCandidates: AddressCandidate[] = [];
  const textCandidates: AddressCandidate[] = [];
  const pdfScores = new Map<string, number>();
  if (opportunity.briefPdfUrl) {
    pdfScores.set(opportunity.briefPdfUrl, 3);
  }

  for (const pageUrl of pageUrls) {
    if (!context.budget.hasRoom()) {
      break;
    }
    const document = await fetchHtmlDocument(context, pageUrl);
    if (!document) {
      continue;
    }

    structuredCandidates.push(...extractStructuredAddressCandidatesFromHtml(document.html));
    if (document.ok) {
      textCandidates.push(...extractAddressCandidatesFromText(stripHtmlToText(document.html), "page"));
    }
    extractPdfUrlsFromHtml(document.html, document.url).forEach((url, index) => {
      const score = Math.max(0, MAX_PDF_URLS_PER_OPPORTUNITY - index);
      if (score > (pdfScores.get(url) ?? Number.NEGATIVE_INFINITY)) {
        pdfScores.set(url, score);
      }
    });
  }

  return {
    pdfCandidates: sortedByScore(pdfScores).slice(0, MAX_PDF_URLS_PER_OPPORTUNITY),
    structuredCandidates: dedupeAddressCandidates(structuredCandidates),
    textCandidates: dedupeAddressCandidates(textCandidates),
  };
};

export const extractAddressCandidatesFromPdfUrls = async (
  context: DocumentContext,
  urls: string[],
): Promise<AddressCandidate[]> => {
  const candidates: AddressCandidate[] = [];
  for (const url of urls.slice(0, MAX_PDF_URLS_PER_OPPORTUNITY)) {
    if (!context.budget.hasRoom()) {
      break;
    }
    const text = await fetchPdfText(context, url);
    if (text) {
      candidates.push(...extractAddressCandidatesFromPdfText(text));
    }
  }
  return dedupeAddressCandidates(candidates);
};
