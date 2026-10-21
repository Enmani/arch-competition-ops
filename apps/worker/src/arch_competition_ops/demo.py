"""``seed-demo``: fictional records for trying out the UI on a throw-away database."""

from __future__ import annotations

from datetime import timedelta

from arch_competition_ops import clock
from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.normalizers.competition import (
    compute_extraction_confidence,
    compute_qualification_score,
)
from arch_competition_ops.review_queue import refresh_review_queue
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import connect, upsert_competitions

DEMO_SOURCE_ID = "demo"
DEMO_SOURCE_NAME = "Demo seed (fictional data)"
DEMO_NOTE = "DEMO RECORD: fictional data for UI testing; not a real notice."
# RFC 2606 reserves .invalid, so these links can never resolve to a real site.
DEMO_URL = "https://example.invalid/demo"


class DemoSeedRefusedError(RuntimeError):
    """The target database already holds records and ``force`` was not given."""


def _demo_records() -> list[CompetitionRecord]:
    today = clock.today()
    records = [
        CompetitionRecord(
            title="Civic Library and Public Square Design Contest",
            organizer="Demo Municipality (fictional)",
            source_id=DEMO_SOURCE_ID,
            source_name=DEMO_SOURCE_NAME,
            authority_name="Demo Municipality (fictional)",
            official_url=f"{DEMO_URL}/library-contest",
            source_url=f"{DEMO_URL}/library-contest",
            opportunity_type="public_design_contest",
            jurisdiction="eu",
            procedure_type="design_contest",
            official_notice_id="DEMO-0001",
            regions=["europe"],
            languages=["en"],
            competition_types=["architecture", "public_building", "urban_design"],
            cpv_codes=["71230000"],
            estimated_contract_value_eur=1850000.0,
            deadline_at=today + timedelta(days=45),
            evidence_level="secondary",
            evidence_note=DEMO_NOTE,
        ),
        CompetitionRecord(
            title="Regional Hospital Campus Expansion Design Services",
            organizer="Demo Health Agency (fictional)",
            source_id=DEMO_SOURCE_ID,
            source_name=DEMO_SOURCE_NAME,
            authority_name="Demo Health Agency (fictional)",
            official_url=f"{DEMO_URL}/hospital-services",
            source_url=f"{DEMO_URL}/hospital-services",
            opportunity_type="public_design_services_procurement",
            jurisdiction="france",
            procedure_type="maitrise_d_oeuvre_procurement",
            official_notice_id="DEMO-0002",
            regions=["europe"],
            languages=["en"],
            competition_types=["architecture", "healthcare", "masterplan"],
            cpv_codes=["71240000"],
            estimated_contract_value_eur=4200000.0,
            deadline_at=today + timedelta(days=75),
            evidence_level="secondary",
            evidence_note=DEMO_NOTE,
        ),
    ]
    for record in records:
        record.extraction_confidence = compute_extraction_confidence(record)
        record.qualification_score = compute_qualification_score(record)
    return records


def seed_demo_records(settings: Settings, *, force: bool = False) -> list[str]:
    db_path = initialize_database(settings)
    if not force:
        with connect(db_path) as connection:
            existing = connection.execute("SELECT COUNT(*) FROM competitions").fetchone()[0]
        if existing:
            raise DemoSeedRefusedError(
                f"{db_path} already holds {existing} competition records; demo data would mix "
                "fictional rows into it. Use a scratch database (ARCH_COMPETITION_OPS_DB) or pass "
                "--force."
            )

    seeded_ids = upsert_competitions(db_path, _demo_records())
    refresh_review_queue(db_path)
    return seeded_ids
