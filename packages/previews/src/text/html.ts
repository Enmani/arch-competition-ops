// HTML entity decoding, tag attribute parsing and tag stripping.
import { normalizeWhitespace } from "./normalize";

export const decodeNumericHtmlEntity = (rawValue: string, radix: 10 | 16, fallback: string) => {
  const codePoint = Number.parseInt(rawValue, radix);
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
    return fallback;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
};

export const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => decodeNumericHtmlEntity(code, 16, match))
    .replace(/&#([0-9]+);/g, (match, code) => decodeNumericHtmlEntity(code, 10, match));

export const decodeJsEscapes = (value: string) =>
  value
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\u([0-9a-f]{4})/gi, (match, code) => decodeNumericHtmlEntity(code, 16, match));

export const normalizePdfScoreText = (value: string) =>
  normalizeWhitespace(decodeJsEscapes(decodeHtmlEntities(value)).replace(/[_-]+/g, " "));

export const stripHtmlToText = (value: string) =>
  normalizeWhitespace(
    decodeHtmlEntities(
      value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );

export const parseTagAttributes = (tag: string) => {
  const attributes: Record<string, string> = {};

  for (const match of tag.matchAll(
    /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )) {
    const [, rawName, doubleQuoted, singleQuoted, bareValue] = match;
    const rawValue = doubleQuoted ?? singleQuoted ?? bareValue ?? "";
    attributes[rawName.toLowerCase()] = decodeHtmlEntities(rawValue);
  }

  return attributes;
};
