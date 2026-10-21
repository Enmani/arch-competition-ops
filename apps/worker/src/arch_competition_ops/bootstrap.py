"""Open the worker database: schema upgrade plus one-time legacy data migration."""

from __future__ import annotations

import logging
from pathlib import Path

from arch_competition_ops.config_loader import load_source_catalog
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import (
    ensure_schema,
    has_unattributed_rows,
    migrate_legacy_source_identity,
)

logger = logging.getLogger(__name__)

# Legacy eligibility_summary values of this extractor may be real clauses (see
# migrate_legacy_source_identity); for every other extractor they were project descriptions.
AMBIGUOUS_ELIGIBILITY_EXTRACTOR = "buyer_profile_parser"


def initialize_database(settings: Settings) -> Path:
    """Ensure the schema exists and attribute pre-``source_id`` rows to their sources.

    The attribution step only runs while unattributed rows exist, so on an already migrated
    database it costs a single ``LIMIT 1`` probe. A broken source catalog must not stop the
    database from opening, so catalog errors are logged and the migration is retried next time.
    """
    db_path = settings.resolve_path(settings.db)
    ensure_schema(db_path)
    if has_unattributed_rows(db_path):
        try:
            sources = [
                (source.source_id, source.name, source.extractor != AMBIGUOUS_ELIGIBILITY_EXTRACTOR)
                for source in load_source_catalog(settings).sources
            ]
        except (OSError, ValueError) as exc:
            logger.warning("Skipping legacy source attribution: %s", exc)
        else:
            migrated = migrate_legacy_source_identity(db_path, sources)
            if migrated:
                logger.info("Attributed %d legacy competition rows to their sources", migrated)
    return db_path
