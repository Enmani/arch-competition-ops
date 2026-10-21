// Read the opportunities to preview straight from the canonical SQLite file, read-only.
//
// The generator deliberately does not go through packages/storage: that package applies pending
// migrations when it opens a database, and an offline batch job must never write to the canonical
// file. The handful of columns read here is the stable `competitions` contract.
import Database from "better-sqlite3";

import type { PreviewOpportunity } from "../types";

type Row = {
  authority_name: string | null;
  brief_pdf_url: string | null;
  documents_portal_url: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  id: string;
  jurisdiction: string | null;
  location_label: string | null;
  official_url: string | null;
  organizer: string | null;
  source_url: string | null;
  title: string;
};

export type ReadOptions = {
  limit?: number;
  /** Explicit ids bypass the visibility filter (a record can be previewed even if hidden). */
  only?: string[];
  today?: string;
};

const titleCase = (value: string | null) =>
  (value ?? "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const blankToNull = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const toOpportunity = (row: Row): PreviewOpportunity => ({
  authorityName: blankToNull(row.authority_name) ?? blankToNull(row.organizer) ?? "",
  briefPdfUrl: row.brief_pdf_url,
  documentsPortalUrl: row.documents_portal_url,
  geoLat: row.geo_lat,
  geoLng: row.geo_lng,
  jurisdictionKey: row.jurisdiction,
  jurisdictionLabel: titleCase(row.jurisdiction),
  locationLabel: row.location_label,
  officialUrl: blankToNull(row.official_url),
  slug: row.id,
  sourceUrl: row.source_url,
  title: row.title,
});

const COLUMNS = `id, title, organizer, authority_name, brief_pdf_url, documents_portal_url,
  jurisdiction, location_label, official_url, source_url, geo_lat, geo_lng`;

export const readOpportunities = (databasePath: string, options: ReadOptions = {}) => {
  const database = new Database(databasePath, { fileMustExist: true, readonly: true });
  try {
    database.pragma("busy_timeout = 5000");
    if (options.only && options.only.length > 0) {
      const placeholders = options.only.map(() => "?").join(", ");
      const rows = database
        .prepare(`SELECT ${COLUMNS} FROM competitions WHERE id IN (${placeholders}) ORDER BY id`)
        .all(...options.only) as Row[];
      return rows.map(toOpportunity);
    }

    // Same visibility as the Web list: archived/discarded never show, expired notices drop out.
    const today = options.today ?? new Date().toISOString().slice(0, 10);
    const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : -1;
    const rows = database
      .prepare(
        `SELECT ${COLUMNS} FROM competitions
         WHERE status NOT IN ('archived', 'discarded')
           AND (deadline_at IS NULL OR deadline_at >= ?)
         ORDER BY COALESCE(deadline_at, '9999-12-31') ASC, id ASC
         LIMIT ?`,
      )
      .all(today, limit) as Row[];
    return rows.map(toOpportunity);
  } finally {
    database.close();
  }
};
