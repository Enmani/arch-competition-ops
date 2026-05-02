import { NextResponse } from "next/server";

import {
  STORED_OPS_REVIEW_REASON_CODES,
  STORED_OPS_REVIEW_STATUSES,
  type StoredOpsReviewDecisionStatus,
  type StoredOpsReviewReasonCode,
  getWebOpsReviewSummary,
  queryWebOpsReviewQueue,
} from "@/lib/server-storage";

import { isOpsReviewEnabled } from "@/lib/ops-review-access";

export const dynamic = "force-dynamic";

const statusOptions = new Set<string>(["all", ...STORED_OPS_REVIEW_STATUSES]);
const reasonOptions = new Set<string>(["all", ...STORED_OPS_REVIEW_REASON_CODES]);

export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status") ?? "pending";
  const rawReasonCode = url.searchParams.get("reasonCode") ?? "all";
  const rawLimit = url.searchParams.get("limit");
  const activeOnly = url.searchParams.get("activeOnly") !== "false";

  if (!statusOptions.has(rawStatus)) {
    return NextResponse.json({ error: `Unsupported review status: ${rawStatus}` }, { status: 400 });
  }

  if (!reasonOptions.has(rawReasonCode)) {
    return NextResponse.json(
      { error: `Unsupported review reason code: ${rawReasonCode}` },
      { status: 400 },
    );
  }

  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
  const status = rawStatus as StoredOpsReviewDecisionStatus | "all";
  const reasonCode = rawReasonCode as StoredOpsReviewReasonCode | "all";

  return NextResponse.json({
    activeOnly,
    items: await queryWebOpsReviewQueue({
      activeOnly,
      limit,
      reasonCode,
      status,
    }),
    limit,
    reasonCode,
    reviewEnabled: isOpsReviewEnabled(),
    status,
    summary: await getWebOpsReviewSummary(),
  });
};
