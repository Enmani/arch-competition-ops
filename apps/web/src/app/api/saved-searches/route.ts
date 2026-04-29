import { NextResponse } from "next/server";

import {
  createStoredSavedSearch,
  deleteStoredSavedSearch,
  queryStoredSavedSearches,
} from "@arch-competition/storage";

import {
  countActiveDiscoverFilters,
  readDiscoverFilters,
  type DiscoverSearchParams,
} from "@/lib/discover";
import {
  isWorkspaceWritesEnabled,
  resolveWorkspaceKey,
} from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const savedSearchClientErrors = new Set([
  "Saved search filters are required.",
  "Saved search name is required",
  "Saved search name must be 80 characters or fewer",
]);

const parseLimit = (rawValue: string | null) => {
  if (!rawValue) {
    return 20;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;
};

export const GET = (request: Request) => {
  const url = new URL(request.url);
  const workspaceKey = resolveWorkspaceKey();
  const limit = parseLimit(url.searchParams.get("limit"));

  return NextResponse.json({
    items: queryStoredSavedSearches({ limit, workspaceKey }),
    limit,
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

  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  const searchParams =
    body["searchParams"] && typeof body["searchParams"] === "object"
      ? (body["searchParams"] as DiscoverSearchParams)
      : {};
  const filters = readDiscoverFilters(searchParams);

  if (!name) {
    return NextResponse.json({ error: "Saved search name is required." }, { status: 400 });
  }

  if (countActiveDiscoverFilters(filters) === 0) {
    return NextResponse.json(
      { error: "Saved search filters are required." },
      { status: 400 },
    );
  }

  try {
    const item = createStoredSavedSearch({
      filters,
      name,
      workspaceKey: resolveWorkspaceKey(),
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create saved search.";
    return NextResponse.json(
      { error: message },
      { status: savedSearchClientErrors.has(message) ? 400 : 500 },
    );
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

  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rawId = body["id"];
  const id =
    typeof rawId === "number"
      ? rawId
      : typeof rawId === "string"
        ? Number.parseInt(rawId, 10)
        : Number.NaN;

  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Saved search id is required." }, { status: 400 });
  }

  try {
    const deleted = deleteStoredSavedSearch({
      id,
      workspaceKey: resolveWorkspaceKey(),
    });

    return NextResponse.json({ alreadyDeleted: !deleted, deleted: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete saved search.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
