import { NextResponse } from "next/server";

import {
  STORED_OPS_REVIEW_STATUSES,
  getWebOpsReviewSummary,
  type StoredOpsReviewDecisionStatus,
  writeWebOpsReviewDecision,
} from "@/lib/server-storage";

import {
  defaultOpsReviewActorLabel,
  isOpsReviewEnabled,
} from "@/lib/ops-review-access";

export const dynamic = "force-dynamic";

type ReviewDecisionRouteContext = {
  params: Promise<{ queueId: string }>;
};

export const PATCH = async (
  request: Request,
  { params }: ReviewDecisionRouteContext,
) => {
  if (!isOpsReviewEnabled()) {
    return NextResponse.json({ error: "Ops review decisions are disabled." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON request body." }, { status: 400 });
  }

  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const decision =
    typeof body["decision"] === "string" ? body["decision"].trim() : "";
  if (!STORED_OPS_REVIEW_STATUSES.includes(decision as StoredOpsReviewDecisionStatus)) {
    return NextResponse.json(
      { error: `Unsupported ops review decision: ${decision || "empty"}` },
      { status: 400 },
    );
  }

  const actorLabel =
    typeof body["actorLabel"] === "string" && body["actorLabel"].trim()
      ? body["actorLabel"].trim()
      : defaultOpsReviewActorLabel;
  const note =
    typeof body["note"] === "string" && body["note"].trim() ? body["note"].trim() : null;
  const { queueId } = await params;

  try {
    const item = await writeWebOpsReviewDecision({
      queueId,
      decision: decision as StoredOpsReviewDecisionStatus,
      actorLabel,
      note,
    });

    return NextResponse.json({
      item,
      summary: await getWebOpsReviewSummary(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write ops review decision.";
    const status = message.includes("Unknown ops review queue item") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
};
