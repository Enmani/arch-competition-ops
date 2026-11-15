import { z } from "zod";

/**
 * The reader-facing part of a stored AI screening result. Advisory text only: it is never a
 * source of canonical facts, so the site shows it labelled as AI output next to the notice link.
 */
export const aiAssessmentSchema = z.object({
  decision: z.enum(["recommend", "exclude", "needs_review"]),
  summary_zh: z.string().trim(),
  summary_en: z.string().trim(),
  reasons_zh: z.array(z.string().trim()).default([]),
  reasons_en: z.array(z.string().trim()).default([]),
  missing_information: z.array(z.string().trim()).default([]),
});

export type AiAssessmentResult = z.infer<typeof aiAssessmentSchema>;
