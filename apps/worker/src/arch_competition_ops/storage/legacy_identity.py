"""Backfill source identities in records that predate the source registry."""

from collections.abc import Iterable
from pathlib import Path

from arch_competition_ops.storage.connection import connect, write_transaction
from arch_competition_ops.storage.schema import ensure_schema


def migrate_legacy_source_identity(db_path: Path, sources: Iterable[tuple[str, str, bool]]) -> int:
    """One-time backfill for rows written before ``source_id``/``source_name`` existed.

    Old rows stored the platform display name in ``organizer`` and had no source columns. For each
    ``(source_id, source_name, eligibility_was_description)`` entry, rows with
    ``source_id IS NULL AND organizer = source_name`` receive the source columns, ``organizer``
    becomes the stored authority (or ``''``), and values the retired extraction code invented are
    cleared: fees (always 0.0), audience (constant), implementation path and licence/partner flags
    (keyword guesses over descriptions), and an ``official_url`` that merely repeated
    ``source_url``. A later ingest re-fills whatever the source states explicitly. Idempotent.

    ``eligibility_summary``: the old pipeline stored the notice *description* there (the only
    place it had for it). The caller sets ``eligibility_was_description`` for sources where that is
    certain, i.e. no collector ever delivered an explicit eligibility/requirements field, so the
    column can only hold prose. Where a stored value might be a genuine clause (the municipal
    buyer-profile parser also reads "Requisiti"/"Requirements" lines from raw pages) the caller
    passes ``False`` and the value is kept: wrongly deleting a real clause is worse than leaving an
    ambiguous one for the next ingest to overwrite.
    """
    ensure_schema(db_path)
    migrated = 0
    with write_transaction(db_path) as connection:
        for source_id, source_name, eligibility_was_description in sources:
            cursor = connection.execute(
                """
                UPDATE competitions
                SET source_id = :source_id,
                    source_name = :source_name,
                    organizer = CASE
                        WHEN authority_name IS NULL OR authority_name = 'Unknown authority' THEN ''
                        ELSE authority_name
                    END,
                    registration_fee_eur = NULL,
                    submission_fee_eur = NULL,
                    audience = '[]',
                    implementation_path = NULL,
                    licensed_architect_required = NULL,
                    local_partner_required = NULL,
                    eligibility_summary = CASE
                        WHEN :clear_eligibility = 1 THEN NULL
                        ELSE eligibility_summary
                    END,
                    official_url = CASE
                        WHEN official_url = source_url THEN NULL
                        ELSE official_url
                    END
                WHERE source_id IS NULL AND organizer = :source_name
                """,
                {
                    "source_id": source_id,
                    "source_name": source_name,
                    "clear_eligibility": int(eligibility_was_description),
                },
            )
            migrated += int(cursor.rowcount or 0)
    return migrated


def has_unattributed_rows(db_path: Path) -> bool:
    ensure_schema(db_path)
    with connect(db_path) as connection:
        return (
            connection.execute(
                "SELECT 1 FROM competitions WHERE source_id IS NULL LIMIT 1"
            ).fetchone()
            is not None
        )
