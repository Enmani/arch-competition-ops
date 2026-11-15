"""Germany's national notice data service (Datenservice Öffentlicher Einkauf).

The service is published at oeffentlichevergabe.de.

One daily bulk export per publication day covers every German e-procurement platform, including
the below-EU-threshold notices that never reach TED. Two exports of the same day are read and
joined per notice (checked against the live service in 2026-11):

* ``format=ocds.zip`` holds the procedure-level ``tender.title``, ``tender.description`` and
  ``buyer.name``. It has no deadlines and no legal basis.
* ``format=ocds2.zip`` holds ``tender.legalBasis``, ``tender.lots[].tenderPeriod.endDate`` and
  update tags (``tenderUpdate``), but drops the procedure title, description and buyer name.

Both name each member ``<noticeId>-<noticeVersion>.json`` and wrap one release in a package whose
``uri`` carries the same notice id and version, which is the join key.

The export of the current day does not exist yet: the service answers HTTP 400 ("The specified
pubDay exceeds the allowed range. It must lie in the past."), so the newest day read is yesterday.

The design scope is defined in ``collectors.design_scope`` and applied locally; AI mode also keeps
design-and-build works contracts (``Totalunternehmer``, ``Planungs- und Bauleistungen``) whose
title or description names the model.
"""

from __future__ import annotations

import io
import json
import logging
import zipfile
from collections.abc import Callable, Iterator
from datetime import date, timedelta
from typing import Any
from urllib import parse

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import DEFAULT_HEADERS, build_url
from arch_competition_ops.collectors.design_scope import has_design_cpv, is_design_and_build
from arch_competition_ops.collectors.relevance import is_design_relevant
from arch_competition_ops.http import HttpStatusError, get_default_client
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.money import format_money_text

logger = logging.getLogger(__name__)

EXPORT_URL = "https://oeffentlichevergabe.de/api/notice-exports"
# The public notice page of the service's own web app (a JavaScript single-page app). The route
# ``/ui/de/search/details`` with ``noticeId`` and ``noticeVersion`` is the one its router builds;
# the page loads ``/api/notices/{noticeId}?format=domain&noticeVersion={v}``, which answers 200
# for a published notice and 404 for an unknown id.
NOTICE_PAGE_URL = "https://oeffentlichevergabe.de/ui/de/search/details"
DEFAULT_LOOKBACK_DAYS = 7
# A day's zip is about 2 MB; the cap only stops a runaway response.
MAX_EXPORT_BYTES = 50 * 1024 * 1024
# A single notice JSON is a few kilobytes; larger members are skipped instead of inflated.
MAX_MEMBER_BYTES = 5 * 1024 * 1024

# Design contests always carry a CPV code and in the data they are 71*; OCDS has no separate
# design-contest field, so the CPV scope of ``collectors.design_scope`` covers them.
OPEN_TAGS = frozenset({"tender", "tenderUpdate"})
CLOSED_TAGS = frozenset({"award", "awardUpdate", "contract", "contractUpdate"})
EVIDENCE_NOTE = (
    "Official German notice from the national notice data service "
    "(Datenservice Öffentlicher Einkauf, oeffentlichevergabe.de), OCDS export."
)

FetchBytes = Callable[[str], bytes | None]


def _default_fetch_bytes(url: str) -> bytes | None:
    """GET an export; ``None`` when the service has no export for that day (404)."""
    try:
        response = get_default_client().get(
            url,
            headers={**DEFAULT_HEADERS, "Accept": "application/zip, */*"},
            max_bytes=MAX_EXPORT_BYTES,
            timeout=120.0,
        )
    except HttpStatusError as exc:
        if exc.status_code == 404:
            return None
        raise
    return response.content


def _export_url(day: date, export_format: str) -> str:
    return build_url(EXPORT_URL, {"pubDay": day.isoformat(), "format": export_format})


def _publication_days(publication_date_from: str | None) -> list[date]:
    """Days to read, newest first: yesterday back to ``publication_date_from`` (inclusive)."""
    newest = clock.today() - timedelta(days=1)
    oldest = (
        date.fromisoformat(publication_date_from)
        if publication_date_from
        else clock.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)
    )
    return [newest - timedelta(days=offset) for offset in range((newest - oldest).days + 1)]


def _notice_key(package: dict[str, Any], release: dict[str, Any]) -> tuple[str, str] | None:
    """``(noticeId, noticeVersion)`` from the package ``uri``.

    The ``uri`` reads ``.../api/notices/{noticeId}?format=ocds&noticeVersion={version}``.
    """
    uri = parse.urlsplit(str(package.get("uri") or ""))
    notice_id = parse.unquote(uri.path.rstrip("/").rsplit("/", 1)[-1]) or str(release.get("id"))
    version = (parse.parse_qs(uri.query).get("noticeVersion") or [""])[0]
    if not notice_id or not version:
        return None
    return notice_id, version


def _read_export(payload: bytes | None) -> dict[tuple[str, str], dict[str, Any]]:
    """Releases of one export zip by notice key; an empty or missing export gives ``{}``."""
    if not payload:
        return {}
    releases: dict[tuple[str, str], dict[str, Any]] = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        for member in archive.infolist():
            if member.is_dir() or not member.filename.endswith(".json"):
                continue
            if member.file_size > MAX_MEMBER_BYTES:
                logger.warning("Skipping oversized export member %s", member.filename)
                continue
            package = json.loads(archive.read(member).decode("utf-8"))
            if not isinstance(package, dict):
                continue
            for release in package.get("releases") or []:
                if not isinstance(release, dict):
                    continue
                key = _notice_key(package, release)
                if key is not None:
                    releases[key] = release
    return releases


def _tags(*releases: dict[str, Any] | None) -> set[str]:
    return {str(tag) for release in releases if release for tag in release.get("tag") or []}


def _opens_participation(release: dict[str, Any], detail: dict[str, Any] | None) -> bool:
    # Contract notices (and their corrections) still invite participation; award, contract and
    # planning-only releases do not.
    tags = _tags(release, detail)
    return bool(tags & OPEN_TAGS) and not tags & CLOSED_TAGS


def _is_eu_wide(detail: dict[str, Any] | None) -> bool:
    """True when the notice was issued under an EU procurement directive, so TED publishes it too.

    ``ocds2`` ``tender.legalBasis.wasDerivedFrom`` (scheme ``CELEX``) is the eForms legal basis
    (BT-01). EU directives are CELEX numbers in sector 3 (``32014L0024``, ``32014L0025``,
    ``32014L0023``, ``32009L0081``); national notices carry ``de-vob``, ``de-vol``, ``de-uvgo``,
    ``de-hhr`` or ``other``. On 2026-11-13, every sampled directive-based notice had a TED
    publication id in the service's own record (``tedPublication.publicationId``, found on TED)
    and no national one had. A notice without a legal basis is kept: it cannot be shown to be a
    TED duplicate.
    """
    tender = (detail or {}).get("tender")
    if not isinstance(tender, dict):
        return False
    legal_basis = tender.get("legalBasis")
    derived = legal_basis.get("wasDerivedFrom") if isinstance(legal_basis, dict) else None
    if not isinstance(derived, dict) or str(derived.get("scheme") or "").upper() != "CELEX":
        return False
    return str(derived.get("id") or "").startswith("3")


def _legal_basis(detail: dict[str, Any] | None) -> str | None:
    tender = (detail or {}).get("tender") or {}
    legal_basis = tender.get("legalBasis") if isinstance(tender, dict) else None
    derived = legal_basis.get("wasDerivedFrom") if isinstance(legal_basis, dict) else None
    value = derived.get("id") if isinstance(derived, dict) else None
    return str(value) if value else None


def _cpv_codes(*releases: dict[str, Any] | None) -> list[str]:
    """Main and additional CPV codes of every item, first occurrence order, 8 digits only."""
    codes: list[str] = []
    for release in releases:
        tender = (release or {}).get("tender")
        if not isinstance(tender, dict):
            continue
        for item in tender.get("items") or []:
            if not isinstance(item, dict):
                continue
            classifications = [
                item.get("classification"),
                *(item.get("additionalClassifications") or []),
            ]
            for classification in classifications:
                if not isinstance(classification, dict):
                    continue
                if str(classification.get("scheme") or "").upper() != "CPV":
                    continue
                code = str(classification.get("id") or "").strip()[:8]
                if len(code) == 8 and code.isdigit() and code not in codes:
                    codes.append(code)
    return codes


def _lots(release: dict[str, Any] | None) -> list[dict[str, Any]]:
    tender = (release or {}).get("tender")
    lots = tender.get("lots") if isinstance(tender, dict) else None
    return [lot for lot in lots or [] if isinstance(lot, dict)]


def _first_text(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _buyer_name(*releases: dict[str, Any] | None) -> str | None:
    for release in releases:
        if not release:
            continue
        buyer = release.get("buyer")
        name = _first_text(buyer.get("name")) if isinstance(buyer, dict) else None
        if name:
            return name
        for party in release.get("parties") or []:
            if isinstance(party, dict) and "buyer" in (party.get("roles") or []):
                name = _first_text(party.get("name"))
                if name:
                    return name
    return None


def _deadline(release: dict[str, Any], detail: dict[str, Any] | None) -> str | None:
    """Earliest explicit submission deadline (ISO date) over the notice and its lots."""
    periods = []
    for candidate in (release, detail):
        tender = (candidate or {}).get("tender")
        if isinstance(tender, dict):
            periods.append(tender.get("tenderPeriod"))
        periods.extend(lot.get("tenderPeriod") for lot in _lots(candidate))
    dates = []
    for period in periods:
        end = period.get("endDate") if isinstance(period, dict) else None
        if isinstance(end, str) and len(end) >= 10:
            try:
                dates.append(date.fromisoformat(end[:10]))
            except ValueError:
                continue
    return min(dates).isoformat() if dates else None


def _location(release: dict[str, Any]) -> str | None:
    tender = release.get("tender") or {}
    for item in tender.get("items") or []:
        address = item.get("deliveryAddress") if isinstance(item, dict) else None
        if isinstance(address, dict):
            locality = _first_text(address.get("locality"))
            if locality:
                return locality
    return None


def _estimated_value(release: dict[str, Any]) -> tuple[float | None, str | None]:
    value = (release.get("tender") or {}).get("value")
    if not isinstance(value, dict) or value.get("amount") is None:
        return None, None
    currency = str(value.get("currency") or "").strip().upper() or None
    text = format_money_text(amount=value.get("amount"), currency=currency)
    if currency == "EUR":
        try:
            return float(value["amount"]), text
        except (TypeError, ValueError):
            return None, text
    return None, text


def _notice_page_url(notice_id: str, version: str) -> str:
    return build_url(NOTICE_PAGE_URL, {"noticeId": notice_id, "noticeVersion": version})


def _build_document(
    key: tuple[str, str],
    release: dict[str, Any],
    detail: dict[str, Any] | None,
    *,
    title: str,
    summary: str | None,
    cpv_codes: list[str],
    include_unclassified: bool,
) -> CollectedSourceDocument:
    tender = release.get("tender") or {}
    notice_url = _notice_page_url(*key)
    value_eur, value_text = _estimated_value(release)
    payload = {
        "title": title,
        # The notice page is a script-rendered shell; the releases are the whole notice, so
        # an empty rawNoticeHtml tells AI enrichment not to fetch it.
        **(
            {"rawNotice": {"ocds": release, "ocds2": detail}, "rawNoticeHtml": ""}
            if include_unclassified
            else {}
        ),
        "buyer": _buyer_name(release, detail),
        # The ocid names the procedure, so a later correction of the same notice updates the
        # same record instead of creating another one.
        "noticeId": release.get("ocid") or key[0],
        "noticeVersion": key[1],
        "deadline": _deadline(release, detail),
        "summary": summary,
        "officialUrl": notice_url,
        "cpv": cpv_codes,
        "publishedAt": release.get("date"),
        "procedureType": _first_text(
            tender.get("procurementMethodDetails"), tender.get("procurementMethod")
        ),
        "legalBasis": _legal_basis(detail),
        "location": _location(release),
        "estimatedValueEur": value_eur,
        "estimatedValueText": value_text,
        "evidenceLevel": "official_notice",
        "evidenceNote": EVIDENCE_NOTE,
    }
    return CollectedSourceDocument(
        source_url=notice_url, payload=json.dumps(payload, ensure_ascii=False)
    )


def _day_releases(
    day: date, fetch_bytes: FetchBytes
) -> Iterator[tuple[tuple[str, str], dict[str, Any], dict[str, Any] | None]]:
    """One day's releases joined with their ``ocds2`` detail, newest release first."""
    releases = _read_export(fetch_bytes(_export_url(day, "ocds.zip")))
    if not releases:
        logger.info("No oeffentlichevergabe.de export for %s", day.isoformat())
        return
    details = _read_export(fetch_bytes(_export_url(day, "ocds2.zip")))
    if not details:
        # Without the detail export there is no legal basis or deadline: TED duplicates cannot be
        # told apart for this day, so they are kept rather than guessed.
        logger.warning("No ocds2 export for %s; EU-wide notices are not filtered", day.isoformat())
    ordered = sorted(
        releases.items(),
        key=lambda entry: (str(entry[1].get("date") or ""), entry[0]),
        reverse=True,
    )
    for key, release in ordered:
        yield key, release, details.get(key)


def collect_oeffentlichevergabe_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_bytes: FetchBytes | None = None,
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    fetch = fetch_bytes or _default_fetch_bytes
    documents: list[CollectedSourceDocument] = []
    # Procedures already decided by a newer release in the window (emitted, awarded or skipped).
    seen_procedures: set[str] = set()
    for day in _publication_days(publication_date_from):
        if len(documents) >= limit:
            break
        for key, release, detail in _day_releases(day, fetch):
            procedure = str(release.get("ocid") or key[0])
            if procedure in seen_procedures:
                continue
            seen_procedures.add(procedure)
            if not _opens_participation(release, detail):
                continue
            cpv_codes = _cpv_codes(release, detail)
            if _is_eu_wide(detail):
                continue
            tender = release.get("tender") or {}
            lots = _lots(detail) or _lots(release)
            title = _first_text(tender.get("title"), *(lot.get("title") for lot in lots)) or ""
            summary = _first_text(
                tender.get("description"), *(lot.get("description") for lot in lots)
            )
            # Design scope: a design CPV; in AI mode also a design-and-build contract.
            if not has_design_cpv(cpv_codes) and not (
                include_unclassified and is_design_and_build(title, summary)
            ):
                continue
            if not include_unclassified and (
                not title or not is_design_relevant(title, summary, cpv_codes=cpv_codes)
            ):
                continue
            documents.append(
                _build_document(
                    key,
                    release,
                    detail,
                    title=title or "Untitled oeffentlichevergabe.de notice",
                    summary=summary,
                    cpv_codes=cpv_codes,
                    include_unclassified=include_unclassified,
                )
            )
            if len(documents) >= limit:
                break
    return documents
