"""AI advisory cache and durable, conservative calendar-month spend ledger."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any
from uuid import uuid4

from arch_competition_ops import clock
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.storage.competitions import upsert_in_connection
from arch_competition_ops.storage.connection import connect, write_transaction
from arch_competition_ops.storage.schema import ensure_schema


class ScreeningBudgetExceeded(RuntimeError):
    pass


def load_screening_candidates(
    db_path: Path, *, limit: int, competition_ids: list[str] | None = None
) -> list[dict[str, Any]]:
    ensure_schema(db_path)
    parameters: list[Any] = []
    clauses = [
        "status NOT IN ('archived', 'discarded')",
        "(deadline_at IS NULL OR deadline_at >= ?)",
    ]
    parameters.append(clock.today().isoformat())
    if competition_ids is not None:
        if not competition_ids:
            return []
        clauses.append(f"id IN ({','.join('?' for _ in competition_ids)})")
        parameters.extend(competition_ids)
    parameters.append(limit)
    with connect(db_path) as connection:
        return [
            dict(row)
            for row in connection.execute(
                f"SELECT * FROM competitions WHERE {' AND '.join(clauses)} "
                "ORDER BY COALESCE(deadline_at, '9999-12-31'), id LIMIT ?",
                parameters,
            )
        ]


def find_cached_screening(db_path: Path, source_url: str, model: str, input_json: str):
    with connect(db_path) as connection:
        return connection.execute(
            "SELECT * FROM ai_screening_runs WHERE source_url = ? AND model = ? "
            "AND input_json = ? AND status = 'completed' ORDER BY started_at DESC LIMIT 1",
            (source_url, model, input_json),
        ).fetchone()


def reserve_screening(
    db_path: Path,
    *,
    competition_id: str | None,
    source_url: str,
    model: str,
    input_json: str,
    reserve_usd: float,
    budget_usd: float,
    daily_budget_usd: float = 1,
) -> str:
    now = clock.now_utc()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    request_id = str(uuid4())
    with write_transaction(db_path) as connection:
        used = connection.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM ai_screening_runs WHERE started_at >= ?",
            (month_start,),
        ).fetchone()[0]
        if used + reserve_usd > budget_usd:
            raise ScreeningBudgetExceeded(
                f"AI monthly budget reached: ${used:.4f} used/reserved, "
                f"${reserve_usd:.4f} needed, ${budget_usd:.2f} limit"
            )
        used_today = connection.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM ai_screening_runs WHERE started_at >= ?",
            (day_start,),
        ).fetchone()[0]
        if used_today + reserve_usd > daily_budget_usd:
            raise ScreeningBudgetExceeded(
                f"AI daily budget reached: ${used_today:.4f} used/reserved, "
                f"${daily_budget_usd:.2f} limit"
            )
        connection.execute(
            "INSERT INTO ai_screening_runs "
            "(id, competition_id, source_url, model, input_json, status, cost_usd, started_at) "
            "VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)",
            (
                request_id,
                competition_id,
                source_url,
                model,
                input_json,
                reserve_usd,
                now.isoformat(),
            ),
        )
    return request_id


def finish_screening(
    db_path: Path,
    request_id: str,
    *,
    status: str,
    result_json: str | None = None,
    error_code: str | None = None,
    response_id: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cost_usd: float | None = None,
) -> None:
    # Unknown network outcomes keep their reservation, including across process restarts.
    with write_transaction(db_path) as connection:
        connection.execute(
            "UPDATE ai_screening_runs SET status = ?, result_json = ?, error_code = ?, "
            "response_id = ?, input_tokens = ?, output_tokens = ?, "
            "cost_usd = COALESCE(?, cost_usd), completed_at = ? WHERE id = ?",
            (
                status,
                result_json,
                error_code,
                response_id,
                input_tokens,
                output_tokens,
                cost_usd,
                clock.now_utc().isoformat(),
                request_id,
            ),
        )


def list_screenings(db_path: Path, *, limit: int = 20, decision: str | None = None):
    ensure_schema(db_path)
    if not 1 <= limit <= 500:
        raise ValueError("Result limit must be between 1 and 500")
    clause = " AND r.decision = ?" if decision else ""
    parameters: list[Any] = [decision] if decision else []
    parameters.append(limit)
    with connect(db_path) as connection:
        return [
            dict(row)
            for row in connection.execute(
                "SELECT r.*, c.title, c.official_url, c.source_url FROM ai_screening_results r "
                "JOIN competitions c ON c.id = r.competition_id "
                "WHERE r.source_updated_at = c.updated_at"
                f"{clause} ORDER BY r.updated_at DESC LIMIT ?",
                parameters,
            )
        ]


def _publish_in_connection(
    connection: sqlite3.Connection,
    *,
    competition_id: str,
    request_id: str,
    model: str,
    decision: str,
    relevance_score: int,
    result_json: str,
    source_updated_at: str,
) -> None:
    connection.execute(
        "UPDATE ai_screening_runs SET competition_id = ?, result_json = ? WHERE id = ?",
        (competition_id, result_json, request_id),
    )
    connection.execute(
        "INSERT INTO ai_screening_results "
        "(competition_id, source_updated_at, model, decision, relevance_score, "
        "result_json, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(competition_id) DO UPDATE SET "
        "source_updated_at=excluded.source_updated_at, model=excluded.model, "
        "decision=excluded.decision, relevance_score=excluded.relevance_score, "
        "result_json=excluded.result_json, updated_at=excluded.updated_at",
        (
            competition_id,
            source_updated_at,
            model,
            decision,
            relevance_score,
            result_json,
            clock.now_utc().isoformat(),
        ),
    )


def publish_screening(db_path: Path, **publication: Any) -> None:
    with write_transaction(db_path) as connection:
        _publish_in_connection(connection, **publication)


def upsert_screened_competitions(
    db_path: Path,
    records: list[CompetitionRecord],
    publications: list[dict[str, Any]],
) -> list[str]:
    """Publish source facts and their exact revision's assessment in one transaction."""
    ensure_schema(db_path)
    ids: list[str] = []
    with write_transaction(db_path) as connection:
        now_iso = clock.now_utc().isoformat()
        for record, publication in zip(records, publications, strict=True):
            competition_id = upsert_in_connection(connection, record, now_iso=now_iso)
            stored = connection.execute(
                "SELECT updated_at FROM competitions WHERE id = ?",
                (competition_id,),
            ).fetchone()
            _publish_in_connection(
                connection,
                competition_id=competition_id,
                source_updated_at=stored["updated_at"],
                **publication,
            )
            ids.append(competition_id)
    return ids
