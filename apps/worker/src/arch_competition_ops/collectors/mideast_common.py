"""Plumbing shared by the Middle East portal collectors (Saudi Arabia, Qatar, Bahrain, Jordan).

These portals have no open-data API. Each one is read the way its own public web page reads
itself, without a login, and every collector keeps to the same rules:

* paced requests (``PACE_SECONDS`` between requests to one host) on a client of its own, so the
  shared default client's unpaced behaviour is not used against a government portal;
* a hard page cap, with a logged warning, on every listing walk;
* a bot-protection challenge is a hard stop: ``raise_if_challenged`` is called on the response of
  every portal that sits behind one, and nothing is retried or solved.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta

from arch_competition_ops import clock
from arch_competition_ops.http import HttpClient
from arch_competition_ops.normalizers.text import strip_html

logger = logging.getLogger(__name__)

DEFAULT_LOOKBACK_DAYS = 7
PACE_SECONDS = 0.5
# Words in the page that mark a bot-protection challenge instead of the portal's own content.
_CHALLENGE_MARKERS = (
    "What code is in the image",
    "Your support ID is",
    "Just a moment...",
    "HUMAN_VERIFICATION_REQUIRED",
)


class PortalChallengeError(RuntimeError):
    """The portal answered with a bot-protection challenge. Never retried or solved."""


def raise_if_challenged(text: str, *, portal: str) -> None:
    head = text[:200_000]
    if any(marker in head for marker in _CHALLENGE_MARKERS):
        raise PortalChallengeError(
            f"{portal} answered with its bot-protection challenge; the collector stops instead "
            "of trying to get past it"
        )


def window_start(publication_date_from: str | None) -> date:
    """First publication day to read: the given date, else ``DEFAULT_LOOKBACK_DAYS`` back."""
    if publication_date_from:
        return date.fromisoformat(publication_date_from[:10])
    return clock.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)


def parse_dmy(value: str | None) -> date | None:
    """``15/11/2026`` (also ``15-11-2026``) as a date, day first; ``None`` when it is not one."""
    match = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", value or "")
    if not match:
        return None
    try:
        return date(int(match.group(3)), int(match.group(2)), int(match.group(1)))
    except ValueError:
        return None


def clean_text(value: str | None) -> str:
    return strip_html(value) or ""


_SCRIPT_OR_STYLE = re.compile(r"<(?:script|style)[^>]*>.*?</(?:script|style)>", flags=re.S | re.I)


def page_text(page: str) -> str:
    """Visible text of a page: script and style bodies dropped, tags and blanks collapsed."""
    return clean_text(_SCRIPT_OR_STYLE.sub(" ", page))


def build_paced_client(*, session=None, **kwargs) -> HttpClient:
    """A client of its own with ``PACE_SECONDS`` between requests, one cookie jar per client."""
    return HttpClient(session=session, min_interval_seconds=PACE_SECONDS, **kwargs)
