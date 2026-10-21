"""A pre-migration ``competitions`` table, for testing in-place schema upgrades."""

from __future__ import annotations

import sqlite3

LEGACY_SCHEMA_SQL = """
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
    prize_summary TEXT,
    deadline_at TEXT,
    eligibility_summary TEXT,
    brief_pdf_url TEXT,
    extraction_confidence REAL NOT NULL,
    evidence_level TEXT NOT NULL,
    qualification_score REAL,
    evidence_note TEXT,
    last_verified_at TEXT,
    discovered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

LEGACY_INSERT_SQL = """
INSERT INTO competitions (
    id, dedup_key, title, organizer, authority_name, official_url, source_url, status,
    opportunity_type, jurisdiction, procedure_type, official_notice_id, regions, languages,
    competition_types, audience, cpv_codes, implementation_path, licensed_architect_required,
    local_partner_required, registration_fee_eur, submission_fee_eur, estimated_contract_value_eur,
    prize_summary, deadline_at, eligibility_summary, brief_pdf_url, extraction_confidence,
    evidence_level, qualification_score, evidence_note, last_verified_at, discovered_at, updated_at
) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
"""


def create_legacy_competitions_table(db_path, *, table_name: str = "competitions") -> None:
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            LEGACY_SCHEMA_SQL.replace("CREATE TABLE competitions", f"CREATE TABLE {table_name}")
        )
        connection.commit()


def insert_legacy_row(
    db_path,
    *,
    table_name: str = "competitions",
    competition_id: str,
    title: str,
    organizer: str,
    source_url: str,
    official_url: str | None = None,
) -> None:
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            LEGACY_INSERT_SQL.replace("INSERT INTO competitions", f"INSERT INTO {table_name}"),
            (
                competition_id,
                competition_id,
                title,
                organizer,
                None,
                official_url,
                source_url,
                "verified",
                "public_design_contest",
                "germany",
                "design_contest",
                None,
                "[]",
                "[]",
                "[]",
                "[]",
                "[]",
                None,
                1,
                0,
                0.0,
                0.0,
                1_000_000.0,
                None,
                "2026-08-01",
                None,
                None,
                0.9,
                "official_notice",
                0.9,
                None,
                "2026-04-19T00:00:00+00:00",
                "2026-04-19T00:00:00+00:00",
                "2026-04-19T00:00:00+00:00",
            ),
        )
        connection.commit()
