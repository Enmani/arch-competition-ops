import { z } from "zod";

import { OPS_REVIEW_REASON_CODES, OPS_REVIEW_STATUSES } from "./taxonomy";

/** Shared API error envelope: `{ error: { code, message } }`. */
export const API_ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "csrf_rejected",
  "unsupported_media_type",
  "storage_unavailable",
  "internal_error",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const OPS_REVIEW_NOTE_MAX_LENGTH = 2000;
export const SAVED_SEARCH_NAME_MAX_LENGTH = 80;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
// The upper bound only protects the hash function from absurd inputs; it is not a policy.
export const PASSWORD_MAX_LENGTH = 1024;

const nullToUndefined = (value: unknown) => (value === null || value === "" ? undefined : value);

const limitParam = (fallback: number, max: number) =>
  z.preprocess(
    nullToUndefined,
    z.coerce
      .number()
      .int()
      .default(fallback)
      .transform((value) => Math.min(Math.max(value, 1), max)),
  );

export const watchlistLimitQuerySchema = z.object({ limit: limitParam(50, 200) });
export const savedSearchLimitQuerySchema = z.object({ limit: limitParam(20, 100) });

export const watchlistMutationSchema = z
  .object({ opportunityId: z.string().trim().min(1).max(500) })
  .strict();

export const savedSearchCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(SAVED_SEARCH_NAME_MAX_LENGTH),
    searchParams: z.record(z.union([z.string(), z.array(z.string()), z.undefined()])),
  })
  .strict();

export const savedSearchDeleteSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

export const opsReviewListQuerySchema = z.object({
  activeOnly: z.preprocess(nullToUndefined, z.enum(["true", "false"]).default("true")),
  limit: limitParam(50, 200),
  reasonCode: z.preprocess(nullToUndefined, z.enum(["all", ...OPS_REVIEW_REASON_CODES]).default("all")),
  status: z.preprocess(nullToUndefined, z.enum(["all", ...OPS_REVIEW_STATUSES]).default("pending")),
});

// `.strict()` rejects `actorLabel`: the actor is always the signed-in administrator.
export const opsReviewDecisionSchema = z
  .object({
    decision: z.enum(OPS_REVIEW_STATUSES),
    note: z.string().trim().max(OPS_REVIEW_NOTE_MAX_LENGTH).nullish(),
  })
  .strict();

export const logoutScopeSchema = z.enum(["current", "all"]).default("current");

// Browser form posts (login/register/logout). Values arrive as strings; lengths are bounded so
// the hash function and the database never see absurd input.
const formText = (max: number) => z.string().max(max).default("");

export const loginFormSchema = z.object({
  email: formText(EMAIL_MAX_LENGTH).transform((value) => value.trim()),
  locale: formText(10),
  next: formText(500),
  password: formText(PASSWORD_MAX_LENGTH),
});

export const registerFormSchema = loginFormSchema.extend({
  passwordConfirmation: formText(PASSWORD_MAX_LENGTH),
});

export const logoutFormSchema = z.object({
  locale: formText(10),
  scope: z.preprocess((value) => (value === "" ? undefined : value), logoutScopeSchema),
});
