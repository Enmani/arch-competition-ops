// Find and rank PDF attachment links in HTML and script text.
import { isPdfLikeUrl, resolveUrlAgainstBase } from "./urls";
import {
  decodeHtmlEntities,
  decodeJsEscapes,
  normalizePdfScoreText,
  parseTagAttributes,
} from "../text/html";

export const rejectedPdfUrlMarkers =
  /\b(?:terms?|conditions?|privacy|cookie|gdpr|nutzungsbedingungen|datenschutz|impressum|legal|accessibility|hilfe|help)\b/iu;

export const strongPreferredPdfUrlMarkers =
  /\b(?:lageplan|site\s*plan|situationsplan|planimetr(?:ia|y)|amtlicher\s+lageplan|projektgrenzen|masterplan)\b/iu;

export const preferredPdfUrlMarkers =
  /\b(?:lageplan|site\s*plan|situation|situationsplan|planimetr(?:ia|y)|plano|plan|projektgrenzen|proyecto|project|brief|beschreibung|leistungsbeschreibung|memoria|sudgel[aä]nde|s[úu]dgel[aä]nde|lokhalle|campus|masterplan)\b/iu;

export const extractPdfUrlsFromText = (value: string, baseUrl: string) => {
  const pdfCandidates: Array<{ score: number; url: string }> = [];
  const scores = new Map<string, number>();
  const normalizeRawUrl = (rawUrl: string | null | undefined) =>
    rawUrl
      ?.trim()
      .replace(/^['"\\]+|['"\\]+$/g, "")
      .replace(/\\\//g, "/")
      .replace(/^&quot;|&quot;$/gi, "") ?? "";
  const pushCandidate = (rawUrl: string | null | undefined, contextText: string) => {
    const resolvedCandidate = resolveUrlAgainstBase(normalizeRawUrl(rawUrl), baseUrl);
    if (!resolvedCandidate) {
      return;
    }

    if (!isPdfLikeUrl(resolvedCandidate) && !/\.pdf\b/iu.test(contextText)) {
      return;
    }

    if (rejectedPdfUrlMarkers.test(decodeHtmlEntities(`${resolvedCandidate} ${contextText}`))) {
      return;
    }

    const decodedContext = normalizePdfScoreText(contextText);
    const decodedUrl = normalizePdfScoreText(resolvedCandidate);
    const score =
      (strongPreferredPdfUrlMarkers.test(decodedContext) ? 4 : 0) +
      (strongPreferredPdfUrlMarkers.test(decodedUrl) ? 2 : 0) +
      (preferredPdfUrlMarkers.test(decodedContext) ? 2 : 0) +
      (preferredPdfUrlMarkers.test(decodedUrl) ? 1 : 0);
    const previousScore = scores.get(resolvedCandidate) ?? Number.NEGATIVE_INFINITY;
    if (score <= previousScore) {
      return;
    }

    scores.set(resolvedCandidate, score);
  };

  for (const match of value.matchAll(
    /href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([^<]{0,240})/giu,
  )) {
    const rawUrl = match[1] ?? match[2] ?? match[3] ?? "";
    const contextText = decodeHtmlEntities(match[4] ?? "");
    pushCandidate(rawUrl, contextText);
  }

  for (const match of value.matchAll(/https?:\/\/[^\s"'<>\\]+/giu)) {
    pushCandidate(match[0], match[0]);
  }

  for (const match of value.matchAll(
    /href\\?=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([^<]{0,240})/giu,
  )) {
    const rawUrl = match[1] ?? match[2] ?? match[3] ?? "";
    const contextText = decodeHtmlEntities(match[4] ?? "");
    pushCandidate(rawUrl, contextText);
  }

  scores.forEach((score, url) => {
    pdfCandidates.push({ score, url });
  });

  return pdfCandidates;
};

export const extractPdfUrlsFromHtml = (html: string, baseUrl: string) => {
  const candidateScores = new Map<string, number>();
  const pushCandidate = (value: string | null | undefined) => {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      /^(?:javascript:|mailto:|tel:|#)/iu.test(value)
    ) {
      return;
    }

    const resolvedCandidate = resolveUrlAgainstBase(value, baseUrl);
    if (!resolvedCandidate || !isPdfLikeUrl(resolvedCandidate)) {
      return;
    }

    if (rejectedPdfUrlMarkers.test(decodeHtmlEntities(resolvedCandidate))) {
      return;
    }

    const decodedUrl = decodeHtmlEntities(resolvedCandidate);
    const score =
      (strongPreferredPdfUrlMarkers.test(decodedUrl) ? 3 : 0) +
      (preferredPdfUrlMarkers.test(decodedUrl) ? 1 : 0);
    const previousScore = candidateScores.get(resolvedCandidate) ?? Number.NEGATIVE_INFINITY;
    if (score > previousScore) {
      candidateScores.set(resolvedCandidate, score);
    }
  };

  for (const match of html.matchAll(/<(?:a|link|iframe|embed|object)\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const rawCandidates = [
      attributes.href,
      attributes.src,
      attributes["data-href"],
      attributes["data-url"],
      attributes.data,
    ];

    for (const rawCandidate of rawCandidates) {
      pushCandidate(rawCandidate);
    }
  }

  const scriptText = decodeJsEscapes(decodeHtmlEntities(html));
  extractPdfUrlsFromText(scriptText, baseUrl).forEach(({ score, url }) => {
    const previousScore = candidateScores.get(url) ?? Number.NEGATIVE_INFINITY;
    if (score > previousScore) {
      candidateScores.set(url, score);
    }
  });

  return [...candidateScores.entries()]
    .map(([url, score]) => ({ score, url }))
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))
    .map((entry) => entry.url);
};
