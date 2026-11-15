/**
 * Reader-facing shaping for the opportunity detail: pure functions, no React.
 *
 * Nothing here adds facts. It sorts the model's free-form "missing information" into a few plain
 * topics, drops machine notes, cleans raw field dumps in notice excerpts, and counts days to a
 * stated deadline.
 */

export type MissingTopic =
  | "buyer"
  | "deadline"
  | "documents"
  | "eligibility"
  | "fees"
  | "implementation"
  | "localPartner"
  | "qualification"
  | "scope"
  | "site"
  | "submission"
  | "value";

/** First match wins, so more specific topics come first ("design fee" is a fee, not a scope). */
const MISSING_RULES: ReadonlyArray<readonly [RegExp, MissingTopic]> = [
  [/local partner/, "localPartner"],
  [/\bfees?\b|\bcosts?\b/, "fees"],
  [/value|budget/, "value"],
  [/deadline/, "deadline"],
  [/licen[cs]|architect (eligib|requir|qualif)/, "qualification"],
  [/eligib|qualif/, "eligibility"],
  [/brief|program|document|notice|source/, "documents"],
  [/\bsite\b|address|city|location/, "site"],
  [/submi/, "submission"],
  [/implementation|route|path/, "implementation"],
  [/buyer|organi[sz]er|authority/, "buyer"],
  [/scope|deliverable|design/, "scope"],
];

/** Processing remarks the screening step wrote for itself; they say nothing about the notice. */
const SYSTEM_NOTE = /unsupported|truncated|could not be fetched|structured record only|no source notice/;

export const classifyMissingInformation = (items: readonly string[]): MissingTopic[] => {
  const topics: MissingTopic[] = [];
  for (const item of items) {
    const text = item.toLowerCase().replace(/[_\-/]+/g, " ").replace(/\s+/g, " ").trim();
    if (!text || SYSTEM_NOTE.test(text)) {
      continue;
    }
    const topic = MISSING_RULES.find(([pattern]) => pattern.test(text))?.[1];
    if (topic && !topics.includes(topic)) {
      topics.push(topic);
    }
  }
  return topics;
};

export type DeadlineCountdown =
  | { kind: "closed" }
  | { kind: "dueToday" }
  | { days: number; kind: "daysLeft" };

const DAY_MS = 86_400_000;

/** Whole UTC days between today and the deadline's date; null when no usable deadline is stated. */
export const countDeadline = (deadlineAt: string | null | undefined, now: Date): DeadlineCountdown | null => {
  if (!deadlineAt) {
    return null;
  }
  const deadline = new Date(deadlineAt);
  if (Number.isNaN(deadline.getTime())) {
    return null;
  }
  const startOf = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  const days = Math.round((startOf(deadline) - startOf(now)) / DAY_MS);
  if (days < 0) {
    return { kind: "closed" };
  }
  return days === 0 ? { kind: "dueToday" } : { days, kind: "daysLeft" };
};

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

const formatStatedDateTime = (value: string, locale: string): string | null => {
  const match = ISO_DATE_TIME.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute] = match;
  // The notice's own clock time is shown as written; no zone conversion is guessed.
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))),
  );
  return hour && minute && !(hour === "00" && minute === "00") ? `${date} ${hour}:${minute}` : date;
};

/**
 * Excerpts are quoted source text, so they stay as written, except for a bare machine field
 * (`"sluitingsDatum": "2026-12-02T12:00:00"`): its field name is a code in the notice's language
 * and its time an ISO string, so only the value remains, as a readable date.
 */
export const humanizeExcerpt = (text: string, intlLocale: string): string => {
  const field = /^\s*"?[A-Za-z_][\w.]*"?\s*:\s*"?([^"]*?)"?\s*,?\s*$/.exec(text);
  if (!field) {
    return text;
  }
  const value = field[1].trim();
  return formatStatedDateTime(value, intlLocale) ?? value;
};

/** Internal source dumps ("AI title [url] ... AI organizer ...") are not notes for a reader. */
export const isMachineNote = (note: string): boolean =>
  /\bAI [a-z_]+ \[?https?:\/\//i.test(note) || /\bAI (title|organizer|authority_name|official_url)\b/.test(note);

/**
 * A stated amount such as "3000000.0 NOK" gains digit grouping. Only a plain integer (optionally
 * with a zero fraction) and a currency code are touched; anything with its own separators
 * ("920 000,00 EUR", "300.000") is shown as written, because its grouping cannot be told apart.
 */
export const prettifyAmountText = (text: string, intlLocale: string): string => {
  const match = /^\s*(\d+)(?:\.0{1,2})?\s+([A-Z]{3})\s*$/.exec(text);
  return match ? `${new Intl.NumberFormat(intlLocale).format(Number(match[1]))} ${match[2]}` : text;
};
