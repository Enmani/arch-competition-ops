// Small URL helpers shared by document fetching and link extraction.

export const getHostname = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const hostMatches = (hostname: string, patterns: string[]) =>
  patterns.some((pattern) => hostname === pattern || hostname.endsWith(`.${pattern}`));

export const isHtmlLikeUrl = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  return !/\.(?:pdf|jpe?g|png|webp|gif|svg)(?:[?#].*)?$/iu.test(value);
};

export const isPdfLikeUrl = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  try {
    return /\.pdf$/iu.test(new URL(value).pathname);
  } catch {
    return /\.pdf(?:[?#].*)?$/iu.test(value);
  }
};

export const dedupeStringValues = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  values.forEach((value) => {
    if (typeof value !== "string") {
      return;
    }

    const normalizedValue = value.trim();
    if (!normalizedValue || seen.has(normalizedValue)) {
      return;
    }

    seen.add(normalizedValue);
    deduped.push(normalizedValue);
  });

  return deduped;
};

export const resolveUrlAgainstBase = (value: string, baseUrl: string) => {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
};
