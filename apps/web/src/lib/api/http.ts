import { createLogger, type ApiErrorBody, type ApiErrorCode, type Logger } from "@arch-competition/core";
import { StorageBusyError, StorageNotFoundError, StorageValidationError } from "@arch-competition/storage";

/**
 * Shared HTTP plumbing for every `/api/*` route handler.
 *
 * Contract: errors always have the shape `{ error: { code, message } }`; 5xx responses carry a
 * generic message only (diagnostics go to the server log); private responses are `no-store`.
 */
export const NO_STORE = "no-store";
export const PUBLIC_LIST_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  conflict: 409,
  csrf_rejected: 403,
  forbidden: 403,
  internal_error: 500,
  invalid_request: 400,
  not_found: 404,
  rate_limited: 429,
  storage_unavailable: 503,
  unauthenticated: 401,
  unsupported_media_type: 415,
};

export class HttpError extends Error {
  readonly code: ApiErrorCode;
  readonly headers: Record<string, string>;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.headers = headers;
    this.status = STATUS_BY_CODE[code];
  }
}

export const jsonResponse = (body: unknown, init: { cacheControl?: string; headers?: HeadersInit; status?: number } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("cache-control", init.cacheControl ?? NO_STORE);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { headers, status: init.status ?? 200 });
};

export const errorResponse = (code: ApiErrorCode, message: string, headers: Record<string, string> = {}) =>
  jsonResponse({ error: { code, message } } satisfies ApiErrorBody, { headers, status: STATUS_BY_CODE[code] });

const logger: Logger = createLogger("web.api");

/**
 * Wraps a handler so thrown `HttpError`s and known storage failures become well-formed error
 * responses, and anything unexpected becomes a generic 500 with the diagnostics logged
 * server-side (never in the response body).
 */
export const guarded =
  <Args extends unknown[]>(routeName: string, handler: (...args: Args) => Promise<Response>) =>
  async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.code, error.message, error.headers);
      }
      if (error instanceof StorageNotFoundError) {
        return errorResponse("not_found", error.message);
      }
      if (error instanceof StorageValidationError) {
        return errorResponse("invalid_request", error.message);
      }
      if (error instanceof StorageBusyError) {
        logger.warn("api.storage_busy", { error, route: routeName });
        return errorResponse("storage_unavailable", "The database is busy. Please retry shortly.", {
          "retry-after": "5",
        });
      }
      logger.error("api.unhandled_error", { error, route: routeName });
      return errorResponse("internal_error", "Something went wrong on our side. Please try again later.");
    }
  };

/** Structural subset of a zod schema, so the web app does not need its own zod dependency edge. */
export type SchemaLike<Output> = {
  safeParse(input: unknown):
    | { data: Output; success: true }
    | { error: { issues: Array<{ message: string; path: Array<string | number> }> }; success: false };
};

export const parseWith = <Output>(schema: SchemaLike<Output>, input: unknown, what: string): Output => {
  const result = schema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || what}: ${issue.message}`)
      .join("; ");
    throw new HttpError("invalid_request", `Invalid ${what}. ${detail}`);
  }
  return result.data;
};

export const readJsonBody = async <Output>(request: Request, schema: SchemaLike<Output>): Promise<Output> => {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError("unsupported_media_type", "Content-Type must be application/json.");
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new HttpError("invalid_request", "Expected a valid JSON request body.");
  }
  return parseWith(schema, payload, "request body");
};

export const searchParamsToRecord = (searchParams: URLSearchParams): Record<string, string | string[]> => {
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    record[key] = values.length === 1 ? values[0] : values;
  }
  return record;
};

/** Cloudflare sets CF-Connecting-IP; elsewhere fall back to proxy headers, then a shared bucket. */
export const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip")?.trim() ||
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip")?.trim() ||
  "unknown";
