from __future__ import annotations

from collections.abc import Callable

from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.verifiers.simap import verify_simap_record

Verifier = Callable[[SourceDefinition, str, str, CompetitionRecord], CompetitionRecord]

VERIFIERS: dict[str, Verifier] = {
    "simap_official_enricher": verify_simap_record,
}


def verify_record(
    *,
    source: SourceDefinition,
    payload: str,
    source_url: str,
    record: CompetitionRecord,
) -> CompetitionRecord:
    if not source.verifier:
        return record

    verifier = VERIFIERS.get(source.verifier)
    if verifier is None:
        raise KeyError(f"No verifier registered for '{source.verifier}'")
    return verifier(source, payload, source_url, record)
