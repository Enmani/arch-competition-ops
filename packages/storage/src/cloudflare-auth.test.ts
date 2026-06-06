import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test from "node:test";

import type { D1DatabaseLike } from "./cloudflare";
import {
  authenticateD1AuthUser,
  countD1AuthUsers,
  createD1AuthSession,
  createD1AuthUser,
  getD1OpportunityFeedItemBySlug,
  getD1AuthSession,
} from "./cloudflare";

type SqlParameter = string | number | null;

const createD1Database = (): D1DatabaseLike => {
  const database = new Database(":memory:");

  return {
    prepare(statement: string) {
      const prepared = database.prepare(statement);
      let boundParameters: SqlParameter[] = [];

      return {
        bind(...values: SqlParameter[]) {
          boundParameters = values;
          return this;
        },
        async all<T = unknown>() {
          return { results: prepared.all(...boundParameters) as T[] };
        },
        async first<T = unknown>() {
          return (prepared.get(...boundParameters) as T | undefined) ?? null;
        },
        async run() {
          const result = prepared.run(...boundParameters);
          return {
            meta: {
              changes: result.changes,
              last_row_id: result.lastInsertRowid,
            },
          };
        },
      };
    },
  };
};

test("D1 auth registration bootstraps auth tables and creates a session", async () => {
  const database = createD1Database();

  const user = await createD1AuthUser(database, {
    email: "  Studio@Example.COM ",
    password: "correct-password",
  });
  const { token } = await createD1AuthSession(database, { userId: user.id });
  const session = await getD1AuthSession(database, token);

  assert.equal(user.email, "studio@example.com");
  assert.equal(await countD1AuthUsers(database), 1);
  assert.equal(session?.user.id, user.id);
  assert.equal(session?.user.email, "studio@example.com");
});

test("D1 auth users can authenticate with the stored password hash", async () => {
  const database = createD1Database();

  const user = await createD1AuthUser(database, {
    email: "login-check@example.com",
    password: "correct-password",
  });

  const authenticatedUser = await authenticateD1AuthUser(database, {
    email: "login-check@example.com",
    password: "correct-password",
  });
  const rejectedUser = await authenticateD1AuthUser(database, {
    email: "login-check@example.com",
    password: "wrong-password",
  });

  assert.equal(authenticatedUser?.id, user.id);
  assert.equal(rejectedUser, null);
});

test("D1 opportunity detail lookup accepts percent-encoded non-ASCII slugs", async () => {
  const database = createD1Database();
  const slug = "servicio-de-asistencia-técnica-para-la-redacción__pcsp-syndicated-notices__2026-06-08";

  await database
    .prepare(`
      CREATE TABLE competitions (
        id TEXT PRIMARY KEY,
        dedup_key TEXT NOT NULL,
        title TEXT NOT NULL,
        organizer TEXT NOT NULL,
        authority_name TEXT,
        official_url TEXT,
        source_url TEXT NOT NULL,
        status TEXT NOT NULL,
        opportunity_type TEXT NOT NULL,
        jurisdiction TEXT,
        procedure_type TEXT,
        official_notice_id TEXT,
        regions TEXT NOT NULL,
        languages TEXT NOT NULL,
        competition_types TEXT NOT NULL,
        project_types TEXT NOT NULL DEFAULT '[]',
        building_categories TEXT NOT NULL DEFAULT '[]',
        official_sectors TEXT NOT NULL DEFAULT '[]',
        built_asset_types TEXT NOT NULL DEFAULT '[]',
        design_scopes TEXT NOT NULL DEFAULT '[]',
        project_modes TEXT NOT NULL DEFAULT '[]',
        audience TEXT NOT NULL,
        cpv_codes TEXT NOT NULL,
        implementation_path TEXT,
        licensed_architect_required INTEGER,
        local_partner_required INTEGER,
        registration_fee_eur REAL,
        submission_fee_eur REAL,
        estimated_contract_value_eur REAL,
        estimated_contract_value_text TEXT,
        prize_summary TEXT,
        location_label TEXT,
        geo_lat REAL,
        geo_lng REAL,
        geo_source TEXT,
        geo_confidence REAL,
        deadline_at TEXT,
        eligibility_summary TEXT,
        brief_pdf_url TEXT,
        documents_portal_url TEXT,
        extraction_confidence REAL NOT NULL,
        evidence_level TEXT NOT NULL,
        qualification_score REAL,
        evidence_note TEXT,
        last_verified_at TEXT,
        discovered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    .run();
  await database
    .prepare(`
      INSERT INTO competitions (
        id, dedup_key, title, organizer, authority_name, official_url, source_url, status,
        opportunity_type, jurisdiction, procedure_type, official_notice_id, regions, languages,
        competition_types, audience, cpv_codes, implementation_path, licensed_architect_required,
        local_partner_required, registration_fee_eur, submission_fee_eur, estimated_contract_value_eur,
        estimated_contract_value_text, prize_summary, location_label, geo_lat, geo_lng, geo_source,
        geo_confidence, deadline_at, eligibility_summary, brief_pdf_url, documents_portal_url,
        extraction_confidence, evidence_level, qualification_score, evidence_note, last_verified_at,
        discovered_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `)
    .bind(
      slug,
      slug,
      "Servicio de asistencia técnica para la redacción",
      "PCSP",
      "Consejería Demo",
      "https://example.com/official",
      "https://example.com/source",
      "discovered",
      "public_design_services_procurement",
      "spain",
      "open",
      "PCSP-001",
      JSON.stringify(["europe", "spain"]),
      JSON.stringify(["es"]),
      JSON.stringify(["urban_design"]),
      JSON.stringify(["professionals"]),
      JSON.stringify(["71410000"]),
      "service_contract_award_after_competitive_selection",
      null,
      null,
      0,
      0,
      321349.83,
      "321.349,83",
      null,
      null,
      null,
      null,
      null,
      null,
      "2026-06-08",
      "Official procurement notice.",
      null,
      null,
      0.78,
      "official_notice",
      0.95,
      "Official PCSP syndication Atom entry.",
      null,
      "2026-05-11T04:35:01.447277+00:00",
      "2026-05-11T12:37:45.874686+00:00",
    )
    .run();

  const opportunity = await getD1OpportunityFeedItemBySlug(
    database,
    "servicio-de-asistencia-t%C3%A9cnica-para-la-redacci%C3%B3n__pcsp-syndicated-notices__2026-06-08",
  );

  assert.equal(opportunity?.id, slug);
  assert.equal(opportunity?.title, "Servicio de asistencia técnica para la redacción");
});
