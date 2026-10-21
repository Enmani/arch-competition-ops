from __future__ import annotations

from datetime import date, time, timedelta

import pytest

from arch_competition_ops import clock
from arch_competition_ops.normalizers.dates import (
    parse_date,
    parse_date_parts,
    parse_date_string,
    slash_order_for_jurisdiction,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026-11-03", date(2026, 11, 3)),
        ("2026-11-03T10:30:00", date(2026, 11, 3)),
        ("2026-11-03 10:30", date(2026, 11, 3)),
        ("2026/11/03", date(2026, 11, 3)),
        ("2026-11-03T10:30:00Z", date(2026, 11, 3)),
        ("2026-11-03T10:30:00.000+01:00", date(2026, 11, 3)),
        ("2026-11-03+01:00", date(2026, 11, 3)),  # TED style: date followed by an offset
        ("2026-11-03-05:00", date(2026, 11, 3)),
        ("03.11.2026", date(2026, 11, 3)),
        ("Frist: 03.11.2026 12:00 Uhr", date(2026, 11, 3)),
        ("Nov 3, 2026", date(2026, 11, 3)),
        ("November 3, 2026", date(2026, 11, 3)),
        ("3 November 2026", date(2026, 11, 3)),
        ("Thu, 05 Nov 2026 13:06:21 +0000", date(2026, 11, 5)),
        ("2026年11月3日 14时30分", date(2026, 11, 3)),
        ("202 6 年 5 月 19 日 13 时 30分", date(2026, 5, 19)),
        ("&amp; 2026-11-03", date(2026, 11, 3)),
    ],
)
def test_supported_formats(raw: str, expected: date) -> None:
    assert parse_date(raw) == expected


@pytest.mark.parametrize(
    "raw", [None, "", "   ", "soon", "2026-13-40", "31.02.2026", "Foo 3, 2026"]
)
def test_unparseable_values_are_none(raw) -> None:
    assert parse_date(raw) is None
    assert parse_date_string(raw) is None


def test_offsets_and_clock_time_are_preserved_in_the_parts() -> None:
    parts = parse_date_parts("2026-11-03T23:30:00-05:00")

    assert parts.day == date(2026, 11, 3)
    assert parts.time_of_day == time(23, 30)
    assert parts.utc_offset == timedelta(hours=-5)
    assert parse_date_parts("2026-11-03+01:00").utc_offset == timedelta(hours=1)
    assert parse_date_parts("2026-11-03T10:00:00Z").utc_offset == timedelta(0)
    assert parse_date_parts("2026-11-03").utc_offset is None


def test_the_stored_date_is_the_buyers_local_day_not_a_utc_conversion() -> None:
    # 23:30 at UTC-5 is already 2026-11-04 in UTC; the notice says 3 November, so we keep 3 November.
    assert parse_date_string("2026-11-03T23:30:00-05:00") == "2026-11-03"


def test_unambiguous_slash_dates_resolve_without_help() -> None:
    assert parse_date("25/12/2026") == date(2026, 12, 25)  # day cannot be a month
    assert parse_date("12/25/2026") == date(2026, 12, 25)  # second part cannot be a month
    assert parse_date("05/05/2026") == date(2026, 5, 5)  # both orders agree


def test_ambiguous_slash_dates_are_not_guessed() -> None:
    assert parse_date("07/08/2026") is None
    assert parse_date("07/08/2026", slash_order=None) is None


def test_ambiguous_slash_dates_follow_the_declared_order() -> None:
    assert parse_date("07/08/2026", slash_order="dmy") == date(2026, 8, 7)
    assert parse_date("07/08/2026", slash_order="mdy") == date(2026, 7, 8)
    assert parse_date("07/08/2026 14:30", slash_order="dmy") == date(2026, 8, 7)


@pytest.mark.parametrize(
    ("jurisdiction", "order"),
    [
        ("italy", "dmy"),
        ("spain", "dmy"),
        ("united_kingdom", "dmy"),
        ("united-kingdom", "dmy"),
        ("united_states", "mdy"),
        ("canada", None),
        ("global", None),
        ("eu", None),
        (None, None),
        ("", None),
    ],
)
def test_slash_order_comes_from_the_jurisdiction(jurisdiction, order) -> None:
    assert slash_order_for_jurisdiction(jurisdiction) == order


def test_there_is_a_single_date_parser() -> None:
    import arch_competition_ops.collectors.common as collectors_common
    import arch_competition_ops.extractors.common as extractors_common

    assert not hasattr(collectors_common, "parse_date_string")
    assert not hasattr(extractors_common, "parse_iso_date")


# -- injectable clock -----------------------------------------------------------------------------


def test_clock_prefers_an_injected_provider_over_the_environment(monkeypatch) -> None:
    monkeypatch.setenv("ARCH_COMPETITION_TODAY", "2031-01-02")
    clock.set_today_provider(lambda: date(2029, 3, 4))

    assert clock.today() == date(2029, 3, 4)


def test_clock_environment_override(monkeypatch) -> None:
    clock.set_today_provider(None)
    monkeypatch.setenv("ARCH_COMPETITION_TODAY", "2031-01-02")

    assert clock.today() == date(2031, 1, 2)


def test_clock_rejects_a_malformed_environment_override(monkeypatch) -> None:
    clock.set_today_provider(None)
    monkeypatch.setenv("ARCH_COMPETITION_TODAY", "next tuesday")

    with pytest.raises(ValueError, match="ARCH_COMPETITION_TODAY"):
        clock.today()


def test_clock_falls_back_to_the_real_date(monkeypatch) -> None:
    clock.set_today_provider(None)
    monkeypatch.delenv("ARCH_COMPETITION_TODAY", raising=False)

    assert clock.today() == date.today()
