import { z } from "zod";

/** Source-language excerpts, not inferred eligibility or additional canonical facts. */
export const noticeDetailSchema = z.object({
  category: z.enum(["timeline", "commercial", "eligibility", "scope", "submission"]),
  text: z.string().trim().min(1),
  evidence_field: z.string().startsWith("notice_"),
  quote: z.string().trim().min(1),
});

export type NoticeDetail = z.infer<typeof noticeDetailSchema>;
