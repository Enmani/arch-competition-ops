from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.storage import update_competition_geocode_fields, upsert_competition
from arch_competition_ops.storage.connection import connect, write_transaction


def test_coordinate_refresh_preserves_current_advice_without_reviving_stale_advice(tmp_path):
    db = tmp_path / "records.sqlite"
    for state in ("current", "stale"):
        key = upsert_competition(
            db, CompetitionRecord(title=state, source_url=f"https://example.org/{state}")
        )
        with write_transaction(db) as c:
            revision = c.execute(
                "SELECT updated_at FROM competitions WHERE id = ?", (key,)
            ).fetchone()[0]
            c.execute(
                "INSERT INTO ai_screening_results VALUES (?, ?, 'luna', 'exclude', 5, '{}', ?)",
                (key, revision if state == "current" else "old", revision),
            )
        update_competition_geocode_fields(
            db,
            competition_id=key,
            location_label="Paris",
            geo_lat=48.8,
            geo_lng=2.3,
            geo_source="nominatim:area",
            geo_confidence=0.6,
        )
        with connect(db) as c:
            row = c.execute(
                "SELECT c.updated_at, a.source_updated_at FROM competitions c JOIN ai_screening_results a ON a.competition_id=c.id WHERE c.id=?",
                (key,),
            ).fetchone()
            assert (row[0] == row[1]) == (state == "current")
