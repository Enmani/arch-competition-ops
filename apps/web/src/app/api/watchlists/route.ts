import { NextResponse } from "next/server";

import {
  createWebWatchlistEntry,
  deleteWebWatchlistEntry,
  listWebWatchedOpportunityIds,
  queryWebWatchlistEntries,
} from "@/lib/server-storage";
import { isWorkspaceWritesEnabled, resolveWorkspaceKey } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const parseLimit = (rawValue: string | null) => {
  if (!rawValue) {
    return 50;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
};

const readOpportunityId = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const body = payload as Record<string, unknown>;
  return typeof body["opportunityId"] === "string" ? body["opportunityId"].trim() : "";
};

export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const workspaceKey = resolveWorkspaceKey();
  const limit = parseLimit(url.searchParams.get("limit"));

  return NextResponse.json({
    items: await queryWebWatchlistEntries({ limit, workspaceKey }),
    watchedOpportunityIds: await listWebWatchedOpportunityIds(workspaceKey),
    workspaceKey,
    writesEnabled: isWorkspaceWritesEnabled(),
  });
};

export const POST = async (request: Request) => {
  if (!isWorkspaceWritesEnabled()) {
    return NextResponse.json({ error: "Workspace writes are disabled." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON request body." }, { status: 400 });
  }

  const opportunityId = readOpportunityId(payload);
  if (!opportunityId) {
    return NextResponse.json({ error: "Opportunity id is required." }, { status: 400 });
  }

  try {
    const item = await createWebWatchlistEntry({
      opportunityId,
      workspaceKey: resolveWorkspaceKey(),
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update watchlist.";
    const status = message.includes("Unknown opportunity id") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
};

export const DELETE = async (request: Request) => {
  if (!isWorkspaceWritesEnabled()) {
    return NextResponse.json({ error: "Workspace writes are disabled." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON request body." }, { status: 400 });
  }

  const opportunityId = readOpportunityId(payload);
  if (!opportunityId) {
    return NextResponse.json({ error: "Opportunity id is required." }, { status: 400 });
  }

  try {
    const deleted = await deleteWebWatchlistEntry({
      opportunityId,
      workspaceKey: resolveWorkspaceKey(),
    });

    return NextResponse.json({
      alreadyDeleted: !deleted,
      deleted: true,
      opportunityId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update watchlist.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
