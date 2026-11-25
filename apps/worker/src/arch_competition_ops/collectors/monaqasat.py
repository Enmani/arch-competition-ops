"""Qatar: the Ministry of Finance unified state procurement site (``monaqasat.mof.gov.qa``).

Shape verified live on 2026-11-15, without a login. ``robots.txt`` allows everything (``Disallow:``
empty). The site's terms of use forbid republishing its contents without written consent, so the
records keep only extracted facts and link to the notice.

* ``/TendersOnlineServices/AvailableMinistriesTenders/<page>`` lists the tenders open for bids,
  15 cards per page, server-rendered Arabic HTML: tender number, title, publication date (``تاريخ
  الطرح``), sector (contracting or suppliers and service providers), agency, type (public tender,
  company prequalification for a limited tender, ...) and closing date. The list holds about 230
  tenders at a time. A page past the end repeats the last page, so paging stops on a page without
  a new tender. The portal's own search is a POST form with an anti-forgery token and is not used;
  the whole list is small enough to read.
* ``/TendersOnlineServices/TenderDetails/<id>`` is the public page of one tender (subject, agency,
  type, closing date, brief, activities, place of work); only the start of it is read.
* Qatar's Public Works Authority (Ashghal) publishes through this site as well, with a one-line
  subject that sends bidders to its own site.
* TLS: the server sends its leaf certificate without the intermediate (DigiCert Global G2 TLS RSA
  SHA256 2020 CA1), so Python, curl and OpenSSL cannot build the chain, while browsers fetch the
  missing certificate themselves. Verification stays on: this module's client trusts the public
  root bundle plus that one intermediate (valid until 2031-03-29). The server also resets TLS 1.2
  handshakes from current OpenSSL, so the client asks for TLS 1.3, which it negotiates cleanly.
"""

from __future__ import annotations

import json
import logging
import re
import ssl
from collections.abc import Callable
from datetime import date
from html import unescape
from typing import Any

import certifi
import requests
from requests.adapters import HTTPAdapter

from arch_competition_ops.collectors.base import CollectedSourceDocument, deferred_detail
from arch_competition_ops.collectors.common import DEFAULT_HEADERS
from arch_competition_ops.collectors.mideast_common import (
    build_paced_client,
    clean_text,
    page_text,
    parse_dmy,
    window_start,
)
from arch_competition_ops.collectors.pagination import (
    numbered_pages,
    page_items,
    page_limit,
    repeated_page,
    unfinished_page,
)
from arch_competition_ops.http import HttpError
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.run_errors import error_class

logger = logging.getLogger(__name__)

SITE = "https://monaqasat.mof.gov.qa"
LIST_URL = SITE + "/TendersOnlineServices/AvailableMinistriesTenders/{page}"
NOTICE_URL = SITE + "/TendersOnlineServices/TenderDetails/{tender_id}"
MAX_PAGES = 40
DETAIL_CHARS = 6000
EVIDENCE_NOTE = "Official Qatari tender from the Ministry of Finance state procurement site."

_DIGICERT_G2_TLS_RSA_SHA256_2020_CA1 = """\
-----BEGIN CERTIFICATE-----
MIIEyDCCA7CgAwIBAgIQDPW9BitWAvR6uFAsI8zwZjANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0yMTAzMzAwMDAwMDBaFw0zMTAzMjkyMzU5NTlaMFkxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxMzAxBgNVBAMTKkRpZ2lDZXJ0IEdsb2Jh
bCBHMiBUTFMgUlNBIFNIQTI1NiAyMDIwIENBMTCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBAMz3EGJPprtjb+2QUlbFbSd7ehJWivH0+dbn4Y+9lavyYEEV
cNsSAPonCrVXOFt9slGTcZUOakGUWzUb+nv6u8W+JDD+Vu/E832X4xT1FE3LpxDy
FuqrIvAxIhFhaZAmunjZlx/jfWardUSVc8is/+9dCopZQ+GssjoP80j812s3wWPc
3kbW20X+fSP9kOhRBx5Ro1/tSUZUfyyIxfQTnJcVPAPooTncaQwywa8WV0yUR0J8
osicfebUTVSvQpmowQTCd5zWSOTOEeAqgJnwQ3DPP3Zr0UxJqyRewg2C/Uaoq2yT
zGJSQnWS+Jr6Xl6ysGHlHx+5fwmY6D36g39HaaECAwEAAaOCAYIwggF+MBIGA1Ud
EwEB/wQIMAYBAf8CAQAwHQYDVR0OBBYEFHSFgMBmx9833s+9KTeqAx2+7c0XMB8G
A1UdIwQYMBaAFE4iVCAYlebjbuYP+vq5Eu0GF485MA4GA1UdDwEB/wQEAwIBhjAd
BgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwdgYIKwYBBQUHAQEEajBoMCQG
CCsGAQUFBzABhhhodHRwOi8vb2NzcC5kaWdpY2VydC5jb20wQAYIKwYBBQUHMAKG
NGh0dHA6Ly9jYWNlcnRzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEdsb2JhbFJvb3RH
Mi5jcnQwQgYDVR0fBDswOTA3oDWgM4YxaHR0cDovL2NybDMuZGlnaWNlcnQuY29t
L0RpZ2lDZXJ0R2xvYmFsUm9vdEcyLmNybDA9BgNVHSAENjA0MAsGCWCGSAGG/WwC
ATAHBgVngQwBATAIBgZngQwBAgEwCAYGZ4EMAQICMAgGBmeBDAECAzANBgkqhkiG
9w0BAQsFAAOCAQEAkPFwyyiXaZd8dP3A+iZ7U6utzWX9upwGnIrXWkOH7U1MVl+t
wcW1BSAuWdH/SvWgKtiwla3JLko716f2b4gp/DA/JIS7w7d7kwcsr4drdjPtAFVS
slme5LnQ89/nD/7d+MS5EHKBCQRfz5eeLjJ1js+aWNJXMX43AYGyZm0pGrFmCW3R
bpD0ufovARTFXFZkAdl9h6g4U5+LXUZtXMYnhIHUfoyMo5tS58aI7Dd8KvvwVVo4
chDYABPPTHPbqjc1qCmBaZx2vN4Ye5DUys/vZwP9BFohFrH/6j/f3IL16/RZkiMN
JCqVJUzKoZHm1Lesh3Sz8W2jmdv51b2EQJ8HmA==
-----END CERTIFICATE-----
"""

_CARD = re.compile(r'<div class="row custom-cards">')
_client = None


class _ChainCompletingAdapter(HTTPAdapter):
    """Verified TLS with the public roots plus the one intermediate this server does not send."""

    def init_poolmanager(self, *args: Any, **kwargs: Any) -> None:
        context = ssl.create_default_context(cafile=certifi.where())
        context.load_verify_locations(cadata=_DIGICERT_G2_TLS_RSA_SHA256_2020_CA1)
        # The server resets the connection when a client offers TLS 1.2 ECDHE suites (checked
        # with OpenSSL 3.5), and negotiates TLS 1.3 cleanly.
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        kwargs["ssl_context"] = context
        super().init_poolmanager(*args, **kwargs)


def _http():
    global _client
    if _client is None:
        session = requests.Session()
        session.mount(SITE, _ChainCompletingAdapter())
        _client = build_paced_client(session=session)
    return _client


def _default_fetch_text(url: str) -> str:
    return _http().get(url, headers={**DEFAULT_HEADERS, "Accept": "text/html,*/*"}).text


def _field(card: str, label: str) -> str | None:
    match = re.search(
        rf"<label>{re.escape(label)}</label>.*?<(?:label|span)>([^<]*)</(?:label|span)>",
        card,
        flags=re.S,
    )
    return unescape(match.group(1)).strip() if match else None


def _parse_cards(page: str) -> list[dict[str, Any]]:
    cards = []
    for block in _CARD.split(page)[1:]:
        tender_id = re.search(r"/TenderDetails/(\d+)", block)
        title = re.search(r"/TenderDetails/\d+\">\s*(.*?)\s*</a>", block, flags=re.S)
        number = re.search(
            r'<span class="card-label">\s*([^<]+?)\s*</span>\s*<span class="card-title">', block
        )
        closing = re.search(r"تاريخ الإغلاق</span><br\s*/?>\s*<span>([^<]+)</span>", block)
        agency = re.search(
            r"<label>الجهة</label></span>\s*<span class=\"card-title\"><span>([^<]*)</span>", block
        )
        kind = re.search(
            r"<label>النوع</label></span>\s*<span class=\"card-title\"><span>([^<]*)</span>", block
        )
        if not tender_id or not title:
            continue
        cards.append(
            {
                "listingText": block,
                "tenderId": tender_id.group(1),
                "tenderNumber": unescape(number.group(1)).strip() if number else None,
                "title": clean_text(title.group(1)),
                "published": parse_dmy(_field(block, "تاريخ الطرح")),
                "sector": _field(block, "نوع القطاع المطلوب"),
                "agency": clean_text(agency.group(1)) if agency else None,
                "type": clean_text(kind.group(1)) if kind else None,
                "closing": parse_dmy(closing.group(1)) if closing else None,
            }
        )
    return cards


def _detail_summary(page: str) -> str:
    """The tender data block of a detail page, before the general terms boilerplate."""
    text = page_text(page[page.find("page-content") :])
    start = text.find("بيانات المناقصة")
    if start < 0:
        return ""
    end = text.find("الشروط العامة", start)
    return text[start : end if end > 0 else None][:DETAIL_CHARS].strip()


def _brief(detail: str | None) -> str | None:
    """The part of the tender data block from its brief on (the part before is table headers)."""
    if not detail:
        return None
    start = detail.find("نبذة مختصرة")
    return detail[start:].strip() if start >= 0 else detail


def _build_document(
    card: dict[str, Any], *, deadline: date | None, detail: str | None
) -> CollectedSourceDocument:
    url = NOTICE_URL.format(tender_id=card["tenderId"])
    payload = {
        "title": card["title"],
        "buyer": card["agency"],
        "noticeId": card["tenderId"],
        "tenderNumber": card["tenderNumber"],
        "deadline": deadline.isoformat() if deadline else None,
        "summary": _brief(detail),
        "officialUrl": url,
        "publishedAt": card["published"].isoformat(),
        "procedureType": card["type"],
        "sector": card["sector"],
        "country": "Qatar",
        "location": "Qatar",
        "evidenceLevel": "official_notice",
        "evidenceNote": EVIDENCE_NOTE,
        "rawNotice": card["listingText"],
        "rawNoticeHtml": detail or "",
    }
    return CollectedSourceDocument(source_url=url, payload=json.dumps(payload, ensure_ascii=False))


def collect_monaqasat_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_text: Callable[[str], str] | None = None,
) -> list[CollectedSourceDocument]:
    """Collect public notices in the requested publication window."""
    start = window_start(publication_date_from)
    get = fetch_text or _default_fetch_text
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for page_number in numbered_pages(range(1, page_limit(MAX_PAGES) + 1)):
        cards = _parse_cards(get(LIST_URL.format(page=page_number)))
        fresh = [card for card in cards if card["tenderId"] not in seen]
        if not fresh:
            if cards:
                repeated_page()
            break
        seen.update(card["tenderId"] for card in fresh)
        for card in page_items(fresh):
            published = card["published"]
            if published is None or published < start:
                continue
            candidates.append(card)
        dated = [card["published"] for card in fresh if card["published"]]
        if dated and max(dated) < start:
            break
    else:
        unfinished_page()
        logger.warning(
            "Monaqasat listing hit the %s-page cap; later pages were not read", MAX_PAGES
        )

    candidates.sort(key=lambda card: card["published"], reverse=True)
    documents = []
    for card in candidates[: max(limit, 0)]:
        detail = None
        try:
            detail = _detail_summary(get(NOTICE_URL.format(tender_id=card["tenderId"])))
        except HttpError as exc:  # a missing detail page must not drop the tender
            if exc.status_code in {403, 429}:
                documents.append(
                    deferred_detail(
                        exc, NOTICE_URL.format(tender_id=card["tenderId"]), card["listingText"]
                    )
                )
                if len(documents) >= limit:
                    return documents
                continue
            logger.warning("Monaqasat detail not read: %s", error_class(exc))
        documents.append(
            _build_document(
                card,
                deadline=card["closing"],
                detail=detail,
            )
        )
    return documents
