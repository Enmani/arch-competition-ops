import { fillTemplate, type CommonCopy } from "../i18n/format";

/**
 * Browser-side wrapper for the JSON API. Components never show server-provided text (it is
 * English and meant for developers); they classify the failure and pick localized copy.
 */
type ApiFailureKind =
  | "forbidden"
  | "generic"
  | "invalid_request"
  | "network"
  | "rate_limited"
  | "unauthenticated"
  | "unavailable";

export type ApiFailure = {
  kind: ApiFailureKind;
  retryAfterSeconds: number | null;
  status: number;
};

type ApiResult<Data> = { data: Data; ok: true } | { failure: ApiFailure; ok: false };

const parseRetryAfter = (value: string | null) => {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
};

/** Maps the HTTP status (and error code, which refines 403/400) to a failure kind. */
export const classifyApiFailure = (
  status: number,
  code: string | null,
  retryAfter: string | null = null,
): ApiFailure => {
  const failure = (kind: ApiFailureKind): ApiFailure => ({
    kind,
    retryAfterSeconds: kind === "rate_limited" || kind === "unavailable" ? parseRetryAfter(retryAfter) : null,
    status,
  });

  if (status === 401 || code === "unauthenticated") return failure("unauthenticated");
  if (status === 403 || code === "forbidden" || code === "csrf_rejected") return failure("forbidden");
  if (status === 429 || code === "rate_limited") return failure("rate_limited");
  if (status === 503 || code === "storage_unavailable") return failure("unavailable");
  if (status === 400 || status === 415 || status === 422) return failure("invalid_request");
  return failure("generic");
};

const readErrorCode = (body: unknown) => {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return null;
  }
  const { error } = body as { error?: { code?: unknown } };
  return typeof error?.code === "string" ? error.code : null;
};

export const requestJson = async <Data>(url: string, init: RequestInit = {}): Promise<ApiResult<Data>> => {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { accept: "application/json", ...init.headers } });
  } catch {
    // fetch only rejects when no response arrived (offline, DNS, CORS, connection reset).
    return { failure: { kind: "network", retryAfterSeconds: null, status: 0 }, ok: false };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An empty or non-JSON body is classified by status alone.
  }

  if (!response.ok) {
    return {
      failure: classifyApiFailure(response.status, readErrorCode(body), response.headers.get("retry-after")),
      ok: false,
    };
  }
  return { data: body as Data, ok: true };
};

export const sendJson = <Data>(url: string, method: "DELETE" | "PATCH" | "POST", payload: unknown): Promise<ApiResult<Data>> =>
  requestJson<Data>(url, {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method,
  });

export const describeApiFailure = (copy: CommonCopy["common"]["apiErrors"], failure: ApiFailure) => {
  switch (failure.kind) {
    case "unauthenticated":
      return copy.unauthenticated;
    case "forbidden":
      return copy.forbidden;
    case "rate_limited":
      return failure.retryAfterSeconds === null
        ? copy.rateLimited
        : fillTemplate(copy.rateLimitedAfter, { seconds: failure.retryAfterSeconds });
    case "unavailable":
      return copy.unavailable;
    case "network":
      return copy.network;
    case "invalid_request":
      return copy.invalidRequest;
    default:
      return copy.generic;
  }
};
