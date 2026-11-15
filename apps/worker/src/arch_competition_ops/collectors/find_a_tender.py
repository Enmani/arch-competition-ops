"""UK Find a Tender Service (FTS) collector.

Since Brexit, UK above-threshold notices are published on Find a Tender instead of TED, and since
the Procurement Act 2023 (in force 2025-02-24) below-threshold tender notices are published there
too. The service exposes OCDS 1.1 release packages at ``/api/1.0/ocdsReleasePackages``.

Live behaviour (checked 2026-11):

- ``updatedFrom`` / ``updatedTo`` (``YYYY-MM-DDTHH:MM:SS``) bound the window; ``limit`` is at most
  100; ``links.next`` carries an opaque ``cursor`` until the last page. A week is ~2,300 releases
  (~23 pages), about 60% of them award or contract notices.
- The documented ``stages=tender`` filter is not usable: for a two-day window it returned 8
  releases where 90 tender-tagged releases existed. Stages are therefore filtered here.
- Releases come newest notice number first. Each release is one notice; its ``id`` (for example
  ``108004-2026``) names the public page ``/Notice/<id>``, which every notice document links to.
- Procurement Act notices carry ``noticeType`` (UK1..UK17) on their notice document; older
  procurements under the 2015 regulations still publish without it, so the stage is read from the
  OCDS ``tag`` and ``tender.status`` rather than from the notice type.
- CPV codes are almost always on ``tender.items[].additionalClassifications`` (3,074 codes in a
  week against 41 main classifications).

The design scope is defined in ``collectors.design_scope`` and applied locally; AI mode also keeps
design-and-build works contracts whose title or description names the model.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import build_url, fetch_json_get
from arch_competition_ops.collectors.design_scope import has_design_cpv, is_design_and_build
from arch_competition_ops.collectors.uk_ocds import (
    OCDS_PAGE_SIZE,
    is_relevant_uk_design_notice,
    iter_ocds_releases,
    pick_buyer_name,
    pick_delivery_location,
    pick_estimated_value,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.text import normalize_text

FIND_A_TENDER_NOTICE_URL = "https://www.find-tender.service.gov.uk/Notice/{notice_id}"
DEFAULT_WINDOW_DAYS = 7
# Tags whose release ends the chance to take part (award, contract details, cancellation...).
CLOSING_TAGS = frozenset(
    {
        "award",
        "awardUpdate",
        "contract",
        "contractUpdate",
        "contractAmendment",
        "contractTermination",
        "implementation",
        "implementationUpdate",
        "tenderCancellation",
    }
)
# Tender-stage tags. A 2015-regulations prior information notice used as the call for
# competition is tagged ["planning", "tender"] and is caught by "tender".
TENDER_TAGS = frozenset({"tender", "tenderUpdate", "tenderAmendment"})
CLOSED_TENDER_STATUSES = frozenset({"cancelled", "unsuccessful", "complete", "withdrawn"})

_NOTICE_ID_PATTERN = re.compile(r"^\d+-\d{4}$")
_NOTICE_URL_PREFIX = "https://www.find-tender.service.gov.uk/Notice/"


def _default_fetch_json(url: str) -> dict:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _resolve_window(publication_date_from: str | None) -> tuple[str, str]:
    today = clock.today()
    updated_from = (
        publication_date_from or (today - timedelta(days=DEFAULT_WINDOW_DAYS)).isoformat()
    )
    return f"{updated_from}T00:00:00", f"{today.isoformat()}T23:59:59"


def _release_state(release: dict[str, Any], tender: dict[str, Any]) -> str | None:
    """``"open"``, ``"closed"`` or ``None`` when this release says nothing about participation.

    Planning releases (pipeline, preliminary market engagement, planned procurement) and status-
    less updates (2015-regulations corrigenda and contract modifications) are neutral: an older
    release of the same procedure decides.
    """
    tags = {tag for tag in release.get("tag") or [] if isinstance(tag, str)}
    if tags & CLOSING_TAGS:
        return "closed"
    if tags & TENDER_TAGS:
        status = tender.get("status")
        if status == "active":
            return "open"
        if status in CLOSED_TENDER_STATUSES:
            return "closed"
    return None


def _cpv_codes(tender: dict[str, Any]) -> list[str]:
    classifications: list[Any] = [tender.get("classification")]
    for item in tender.get("items") or []:
        if isinstance(item, dict):
            classifications.append(item.get("classification"))
            classifications += item.get("additionalClassifications") or []

    codes: list[str] = []
    for classification in classifications:
        if not isinstance(classification, dict):
            continue
        scheme = str(classification.get("scheme") or "CPV").strip().upper()
        code = str(classification.get("id") or "").strip()
        if scheme == "CPV" and code and code not in codes:
            codes.append(code)
    return codes


def _is_design_contest(tender: dict[str, Any]) -> bool:
    text = normalize_text(
        f"{tender.get('procurementMethodDetails') or ''} {tender.get('title') or ''}"
    )
    return "design contest" in text


def _notice_documents(release: dict[str, Any]) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    for section in ("tender", "planning"):
        block = release.get(section)
        if isinstance(block, dict):
            documents += [d for d in block.get("documents") or [] if isinstance(d, dict)]
    return [d for d in documents if d.get("noticeType")]


def _notice_page_url(release: dict[str, Any]) -> str | None:
    notice_id = str(release.get("id") or "").strip()
    if _NOTICE_ID_PATTERN.match(notice_id):
        return FIND_A_TENDER_NOTICE_URL.format(notice_id=notice_id)
    for document in _notice_documents(release):
        url = str(document.get("url") or "").strip()
        if url.startswith(_NOTICE_URL_PREFIX):
            return url
    return None


def _build_payload(
    release: dict[str, Any],
    tender: dict[str, Any],
    *,
    official_url: str,
    cpv_codes: list[str],
    design_contest: bool,
    include_raw: bool,
) -> str:
    estimated_value_eur, estimated_value_text = pick_estimated_value(tender)
    notice_types = [d["noticeType"] for d in _notice_documents(release)]
    return json.dumps(
        {
            "title": (tender.get("title") or "").strip(),
            **({"rawNotice": release} if include_raw else {}),
            "buyer": pick_buyer_name(release),
            "noticeId": release.get("ocid"),
            "noticeType": notice_types[0] if notice_types else None,
            "deadline": (tender.get("tenderPeriod") or {}).get("endDate"),
            "estimatedValueEur": estimated_value_eur,
            "estimatedValueText": estimated_value_text,
            "location": pick_delivery_location(tender),
            "summary": (tender.get("description") or "").strip(),
            "officialUrl": official_url,
            "cpv": cpv_codes,
            "opportunityType": (
                "public_design_contest" if design_contest else "public_design_services_procurement"
            ),
            "procedureType": tender.get("procurementMethodDetails")
            or tender.get("procurementMethod"),
            "evidenceLevel": "official_notice",
            "evidenceNote": "Official UK Find a Tender OCDS release.",
            "publishedAt": tender.get("datePublished") or release.get("date"),
        },
        ensure_ascii=False,
    )


def collect_find_a_tender_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: Callable[[str], dict] | None = None,
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    """Open Find a Tender notices in scope, at most ``limit``, newest first.

    One document per procedure (ocid). Because releases arrive newest first, the first release of
    an ocid that is open or closed decides it: a later award or cancellation hides the tender.
    With ``include_unclassified`` (AI mode) only the stage and the design scope apply (design CPV,
    design contest or design-and-build title); otherwise the CPV or contest scope and the
    Contracts Finder relevance rules apply.
    """
    updated_from, updated_to = _resolve_window(publication_date_from)
    search_url = build_url(
        source.base_url,
        {"limit": OCDS_PAGE_SIZE, "updatedFrom": updated_from, "updatedTo": updated_to},
    )

    kept: list[tuple[str, CollectedSourceDocument]] = []
    if limit <= 0:
        return []
    decided_ocids: set[str] = set()
    for release in iter_ocds_releases(search_url, fetch_json or _default_fetch_json):
        ocid = release.get("ocid")
        if not isinstance(ocid, str) or not ocid or ocid in decided_ocids:
            continue
        tender = release.get("tender") if isinstance(release.get("tender"), dict) else {}
        state = _release_state(release, tender)
        if state is None:
            continue
        decided_ocids.add(ocid)
        if state == "closed":
            continue

        official_url = _notice_page_url(release)
        if official_url is None:
            continue
        cpv_codes = _cpv_codes(tender)
        design_contest = _is_design_contest(tender)
        title = (tender.get("title") or "").strip()
        description = (tender.get("description") or "").strip()
        # Design scope: a design CPV or a design contest; in AI mode also a design-and-build
        # contract whatever its CPV.
        if not (
            design_contest
            or has_design_cpv(cpv_codes)
            or (include_unclassified and is_design_and_build(title, description))
        ):
            continue
        if not include_unclassified and (
            not title or not is_relevant_uk_design_notice(title, description, cpv_codes)
        ):
            continue

        payload = _build_payload(
            release,
            tender,
            official_url=official_url,
            cpv_codes=cpv_codes,
            design_contest=design_contest,
            include_raw=include_unclassified,
        )
        kept.append(
            (str(release.get("date") or ""), CollectedSourceDocument(official_url, payload))
        )
        if len(kept) >= limit:
            break

    kept.sort(key=lambda entry: entry[0], reverse=True)
    return [document for _, document in kept]
