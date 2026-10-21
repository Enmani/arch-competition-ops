"""Single date parser for notices, feeds, and listing pages.

Replaces the two older parsers (``collectors.common.parse_date_string`` and
``extractors.common.parse_iso_date``) that disagreed about offsets and slash dates.

Time zone policy
----------------
``competitions.deadline_at`` is a date column, so persisted deadlines are calendar *dates*. The
parser still reads the clock time and UTC offset (``ParsedDate``) so callers that later gain a
timestamp column can keep them, but ``parse_date``/``parse_date_string`` return the date exactly as
the buyer wrote it, *without* converting to UTC. Consequence: a deadline of
``2026-11-03T23:30:00-05:00`` is stored as 2026-11-03 even though it is 2026-11-04 in UTC, and
the hour is lost, so the web layer must not claim hour-level precision. We keep the buyer's local
day on purpose: converting would move deadlines to a day the notice never mentions, which is a
worse truth violation than dropping the clock time. Extending the schema is out of scope here.

Slash dates
-----------
``07/08/2026`` is 7 August in most of the world and 8 July in the United States. The parser only
resolves a slash date when it is unambiguous (one part is above 12) or when the caller names the
order, normally via ``slash_order_for_jurisdiction(source.jurisdiction)``. Otherwise it returns
``None`` instead of guessing: a missing deadline is visible, a wrong one is not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, time, timedelta
from html import unescape
from typing import Literal

SlashOrder = Literal["dmy", "mdy"]

# Jurisdictions whose slash dates are month-first.
_MDY_JURISDICTIONS = frozenset({"united_states", "usa", "us"})
# Jurisdictions where both orders are used in practice, plus non-country scopes: never guess.
_AMBIGUOUS_JURISDICTIONS = frozenset({"canada", "global", "unknown", "eu", ""})

_MONTHS = {
    name: number
    for number, names in enumerate(
        (
            ("january", "jan"),
            ("february", "feb"),
            ("march", "mar"),
            ("april", "apr"),
            ("may",),
            ("june", "jun"),
            ("july", "jul"),
            ("august", "aug"),
            ("september", "sep", "sept"),
            ("october", "oct"),
            ("november", "nov"),
            ("december", "dec"),
        ),
        start=1,
    )
    for name in names
}

_TZ = r"(?P<tz>Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)"
_CHINESE_RE = re.compile(
    r"(?P<y>(?:\d\s*){4})\s*年\s*(?P<m>\d{1,2})\s*月\s*(?P<d>\d{1,2})\s*日"
    r"(?:\s*(?P<H>\d{1,2})\s*[时点:：]\s*(?P<M>\d{1,2})(?:\s*分)?)?"
)
_ISO_RE = re.compile(
    r"(?<!\d)(?P<y>\d{4})[-/](?P<m>\d{1,2})[-/](?P<d>\d{1,2})(?!\d)"
    r"(?:[T\s]+(?P<H>\d{1,2}):(?P<M>\d{2})(?::(?P<S>\d{2})(?:[.,]\d+)?)?)?"
    rf"\s*{_TZ}?"
)
_DOTTED_RE = re.compile(
    r"(?<!\d)(?P<d>\d{1,2})\.(?P<m>\d{1,2})\.(?P<y>\d{4})(?!\d)"
    r"(?:[,\s]+(?P<H>\d{1,2})[:.](?P<M>\d{2}))?"
)
_SLASH_RE = re.compile(
    r"(?<!\d)(?P<a>\d{1,2})[/-](?P<b>\d{1,2})[/-](?P<y>\d{4})(?!\d)"
    r"(?:[,\s]+(?P<H>\d{1,2}):(?P<M>\d{2}))?"
)
_DAY_MONTH_NAME_RE = re.compile(
    r"(?<![A-Za-z0-9])(?P<d>\d{1,2})(?:st|nd|rd|th)?\s+(?P<mon>[A-Za-z]{3,9})\.?,?\s+(?P<y>\d{4})"
    rf"(?:\s+(?P<H>\d{{1,2}}):(?P<M>\d{{2}})(?::(?P<S>\d{{2}}))?)?(?:\s*{_TZ})?"
)
_MONTH_NAME_DAY_RE = re.compile(
    r"(?<![A-Za-z])(?P<mon>[A-Za-z]{3,9})\.?\s+(?P<d>\d{1,2})(?:st|nd|rd|th)?,?\s+(?P<y>\d{4})"
)


@dataclass(frozen=True)
class ParsedDate:
    """A parsed calendar date plus whatever clock/offset detail the text carried."""

    day: date
    time_of_day: time | None = None
    utc_offset: timedelta | None = None


def slash_order_for_jurisdiction(jurisdiction: str | None) -> SlashOrder | None:
    """Slash-date order implied by a source jurisdiction, or ``None`` when it is not knowable."""
    key = (jurisdiction or "").strip().lower().replace("-", "_")
    if key in _AMBIGUOUS_JURISDICTIONS:
        return None
    if key in _MDY_JURISDICTIONS:
        return "mdy"
    return "dmy"


def _parse_offset(raw_offset: str | None) -> timedelta | None:
    if not raw_offset:
        return None
    if raw_offset.upper() in {"Z", "UTC", "GMT"}:
        return timedelta(0)
    sign = -1 if raw_offset[0] == "-" else 1
    digits = raw_offset[1:].replace(":", "")
    hours = int(digits[:2])
    minutes = int(digits[2:4]) if len(digits) >= 4 else 0
    if hours > 14 or minutes > 59:
        return None
    return sign * timedelta(hours=hours, minutes=minutes)


def _build(
    year: int,
    month: int,
    day: int,
    hour: str | None = None,
    minute: str | None = None,
    second: str | None = None,
    offset: str | None = None,
) -> ParsedDate | None:
    try:
        parsed_day = date(year, month, day)
        parsed_time = time(int(hour), int(minute), int(second or 0)) if hour and minute else None
    except ValueError:
        return None
    return ParsedDate(parsed_day, parsed_time, _parse_offset(offset))


def _parse_slash(match: re.Match[str], slash_order: SlashOrder | None) -> ParsedDate | None:
    first, second, year = int(match["a"]), int(match["b"]), int(match["y"])
    if first > 12 and second <= 12:
        day, month = first, second
    elif second > 12 and first <= 12:
        month, day = first, second
    elif first == second:
        day, month = first, second
    elif slash_order == "dmy":
        day, month = first, second
    elif slash_order == "mdy":
        month, day = first, second
    else:
        return None
    return _build(year, month, day, match["H"], match["M"])


def parse_date_parts(
    raw_value: str | None, *, slash_order: SlashOrder | None = None
) -> ParsedDate | None:
    """Parse the first recognizable date in ``raw_value``; ``None`` when nothing is certain."""
    if not raw_value:
        return None
    text = re.sub(r"\s+", " ", unescape(raw_value)).strip()
    if not text:
        return None

    if match := _CHINESE_RE.search(text):
        year = int(re.sub(r"\s+", "", match["y"]))
        return _build(year, int(match["m"]), int(match["d"]), match["H"], match["M"])

    if match := _ISO_RE.search(text):
        return _build(
            int(match["y"]),
            int(match["m"]),
            int(match["d"]),
            match["H"],
            match["M"],
            match["S"],
            match["tz"],
        )

    if match := _DOTTED_RE.search(text):
        return _build(int(match["y"]), int(match["m"]), int(match["d"]), match["H"], match["M"])

    if match := _SLASH_RE.search(text):
        return _parse_slash(match, slash_order)

    if match := _DAY_MONTH_NAME_RE.search(text):
        month = _MONTHS.get(match["mon"].lower())
        if month is not None:
            return _build(
                int(match["y"]),
                month,
                int(match["d"]),
                match["H"],
                match["M"],
                match["S"],
                match["tz"],
            )

    if match := _MONTH_NAME_DAY_RE.search(text):
        month = _MONTHS.get(match["mon"].lower())
        if month is not None:
            return _build(int(match["y"]), month, int(match["d"]))

    return None


def parse_date(raw_value: str | None, *, slash_order: SlashOrder | None = None) -> date | None:
    parsed = parse_date_parts(raw_value, slash_order=slash_order)
    return parsed.day if parsed else None


def parse_date_string(
    raw_value: str | None, *, slash_order: SlashOrder | None = None
) -> str | None:
    parsed = parse_date(raw_value, slash_order=slash_order)
    return parsed.isoformat() if parsed else None
