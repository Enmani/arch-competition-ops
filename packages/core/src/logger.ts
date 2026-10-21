/**
 * Minimal structured logger shared by storage and the web app.
 *
 * One JSON line per event so Cloudflare Workers Logs / `next dev` output stays greppable.
 * Safety rules (see docs/structures/2026-10-21-storage-auth-api-architecture.md):
 * - values under keys that look like credentials are replaced by "[redacted]" (passwords,
 *   tokens, secrets, cookies, hashes, authorization headers, API keys, session material);
 * - emails are the only personal data allowed in fields, callers must never pass raw
 *   request bodies;
 * - error objects are reduced to name/message/code/stack, never the cause chain payload.
 */
export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

export type LogSink = Pick<Console, "debug" | "info" | "warn" | "error">;

const SENSITIVE_KEY_PATTERN = /pass(word|wd)?|token|secret|authorization|cookie|hash|api[-_]?key|session|credential|private/i;
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 3;

export const serializeError = (error: unknown): LogFields => {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      message: truncate(error.message),
      ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
      ...(error.stack ? { stack: truncate(error.stack, 2000) } : {}),
    };
  }
  return { message: truncate(String(error)) };
};

const truncate = (value: string, max = MAX_STRING_LENGTH) =>
  value.length > max ? `${value.slice(0, max)}...[truncated]` : value;

export const redactFields = (value: unknown, depth = 0): unknown => {
  if (value instanceof Error) {
    return serializeError(value);
  }
  if (typeof value === "string") {
    return truncate(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return "[depth-limit]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactFields(item, depth + 1));
  }

  const output: LogFields = {};
  for (const [key, item] of Object.entries(value as LogFields)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redactFields(item, depth + 1);
  }
  return output;
};

export const createLogger = (scope: string, sink: LogSink = console): Logger => {
  const write = (level: keyof LogSink, event: string, fields?: LogFields) => {
    sink[level](
      JSON.stringify({
        level,
        scope,
        event,
        time: new Date().toISOString(),
        ...(fields ? (redactFields(fields) as LogFields) : {}),
      }),
    );
  };

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
};

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
