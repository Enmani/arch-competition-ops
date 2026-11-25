"""Official structured lifecycle checks for notices that are already awarded or closed.

Only unambiguous official procurement lifecycle codes (contract award, direct award, cancellation,
post-award modification, or terminated/expired status) are recognized here. Scope, CPV, title,
geography, language and value are never filtered here.
"""

from __future__ import annotations

import json
import re
from typing import Any

from arch_competition_ops.screening.models import Evidence, ScreeningDecision

_OCDS_CLOSED_TAGS = frozenset(
    {
        "award",
        "awardUpdate",
        "awardCancellation",
        "contract",
        "contractUpdate",
        "contractAmendment",
        "implementation",
        "implementationUpdate",
        "tenderCancellation",
    }
)
_OCDS_OPEN_TENDER_STATUSES = frozenset({"active", "planned", "planning"})
_OCDS_CLOSED_TENDER_STATUSES = frozenset({"cancelled", "unsuccessful", "complete", "withdrawn"})

_ANAC_CLOSED_SCHEDA = re.compile(r"^(?:ad(?:$|[\d_])|a\d+_)", re.IGNORECASE)
_PCSP_STATUS_TAG = re.compile(
    r"<(?:[\w-]+:)?ContractFolderStatusCode>\s*([A-Za-z0-9_-]+)\s*</(?:[\w-]+:)?ContractFolderStatusCode>"
)
_PCSP_CLOSED_STATUSES = frozenset({"RES", "ADJ", "ANUL", "DES"})

_DOFFIN_CLOSED_TYPES = frozenset(
    {
        "ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT",
        "ANNOUNCEMENT_OF_INTENT",
        "RESULT",
        "CONTRACT_AWARD",
        "DIRECT_AWARD",
        "DESIGN_CONTEST_RESULT",
    }
)
_DOFFIN_CLOSED_STATUSES = frozenset({"AWARDED", "CANCELLED", "EXPIRED"})

_SIMAP_CLOSED_PUB_TYPES = frozenset(
    {
        "award",
        "award_tender",
        "award_competition",
        "award_study_contract",
        "direct_award",
        "abandonment",
        "revocation",
    }
)

_TENDERNED_CLOSED_TYPES = frozenset({"AGO", "AAW", "VBE"})
# Official EU eForms subtypes 25-28 (VEAT), 29-37 (CAN / contest results), 38-40 (modifications).
_TENDERNED_CLOSED_EFORMS = frozenset({f"EF{n}" for n in range(25, 41)})

_BOAMP_CLOSED_NATURES = frozenset({"ATTRIBUTION", "RESULTAT", "AVIS_INTENTION_CONCLURE"})


def _text(value: Any) -> str:
    if isinstance(value, list):
        for item in value:
            found = _text(item)
            if found:
                return found
        return ""
    if isinstance(value, str):
        return value.strip()
    return ""


def _parse_envelope(payload: str) -> dict[str, Any] | None:
    stripped = payload.lstrip()
    if not stripped.startswith("{"):
        return None
    try:
        data, _ = json.JSONDecoder().raw_decode(stripped)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _check_ocds(release: dict[str, Any]) -> tuple[str, str] | None:
    tender = release.get("tender")
    tender_status = _text(tender.get("status")).lower() if isinstance(tender, dict) else ""
    if tender_status in _OCDS_CLOSED_TENDER_STATUSES:
        return f"ocds:tender_status:{tender_status}", f"tender.status: {tender_status}"
    raw_tags = release.get("tag")
    if isinstance(raw_tags, list):
        tags = [_text(tag) for tag in raw_tags if _text(tag)]
        if (
            tags
            and set(tags) <= _OCDS_CLOSED_TAGS
            and tender_status not in _OCDS_OPEN_TENDER_STATUSES
        ):
            return f"ocds:tag:{tags[0]}", f"tag: {', '.join(tags)}"
    return None


def closed_lifecycle_reason(payload: str) -> tuple[str, str] | None:
    """Return ``(code, evidence_quote)`` when an official field marks the notice closed."""
    if not payload:
        return None
    envelope = _parse_envelope(payload)
    if envelope is None:
        return None

    raw = envelope.get("rawNotice")
    if isinstance(raw, str) and raw.lstrip().startswith("{"):
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = None
        if isinstance(parsed, dict):
            raw = parsed

    # 1. TED eForms notice-type (can-* contract award / contest result / modification, veat)
    ted_type = _text(envelope.get("noticeType")) or (
        _text(raw.get("notice-type")) if isinstance(raw, dict) else ""
    )
    ted_lower = ted_type.lower()
    if ted_lower.startswith("can-") or ted_lower == "veat":
        return f"ted:{ted_lower}", f"noticeType: {ted_type}"

    # 2. World Bank procnotices notice_type ("Contract Award")
    wb_type = _text(raw.get("notice_type")) if isinstance(raw, dict) else ""
    for candidate in (wb_type, ted_type):
        if candidate.casefold() == "contract award":
            return "world_bank:contract_award", f"notice_type: {candidate}"

    # 3. OCDS releases (UK Find a Tender, UK Contracts Finder, DE oeffentlichevergabe)
    if isinstance(raw, dict):
        ocds_candidates: list[dict[str, Any]] = []
        if "ocds" in raw and isinstance(raw["ocds"], dict):
            ocds_candidates.append(raw["ocds"])
            if isinstance(raw.get("ocds2"), dict):
                ocds_candidates.append(raw["ocds2"])
        elif "ocid" in raw or "tag" in raw:
            ocds_candidates.append(raw)
        for release in ocds_candidates:
            if hit := _check_ocds(release):
                return hit

    # 4. Italy ANAC (codiceScheda AD* / A<digits>_ or tipo == esito)
    if isinstance(raw, dict):
        scheda = _text(raw.get("codiceScheda"))
        tipo = _text(raw.get("tipo")).lower()
        if scheda and _ANAC_CLOSED_SCHEDA.match(scheda):
            return f"anac:{scheda.lower()}", f"codiceScheda: {scheda}"
        if tipo == "esito" and ("idAvviso" in raw or "codiceScheda" in raw):
            return "anac:esito", "tipo: esito"

    # 5. Spain PCSP (CODICE Atom ContractFolderStatusCode)
    folder_status = _text(envelope.get("folderStatus")).upper()
    if not folder_status and isinstance(raw, str) and "ContractFolderStatusCode" in raw:
        match = _PCSP_STATUS_TAG.search(raw)
        if match:
            folder_status = match.group(1).upper()
    if folder_status in _PCSP_CLOSED_STATUSES:
        return f"pcsp:{folder_status.lower()}", f"ContractFolderStatusCode: {folder_status}"

    # 6. Norway Doffin / Switzerland SIMAP / Netherlands TenderNed (listing + detail envelopes)
    if isinstance(raw, dict):
        listing = raw.get("listing") if isinstance(raw.get("listing"), dict) else None
        detail = raw.get("detail") if isinstance(raw.get("detail"), dict) else None

        # Doffin (normal listing/detail envelope or deferred_detail raw listing)
        for block in (detail, listing, raw):
            if not isinstance(block, dict):
                continue
            d_type = _text(block.get("noticeType") or block.get("type")).upper()
            if d_type in _DOFFIN_CLOSED_TYPES:
                return f"doffin:{d_type.lower()}", f"type: {d_type}"
            d_status = _text(block.get("status")).upper()
            if d_status in _DOFFIN_CLOSED_STATUSES and (
                "heading" in block or "doffinId" in block or "allCpvCodes" in block
            ):
                return f"doffin:status:{d_status.lower()}", f"status: {d_status}"

        # SIMAP
        simap_candidates = []
        for block in (listing, raw):
            if isinstance(block, dict):
                simap_candidates.append(_text(block.get("pubType")).lower())
        if isinstance(detail, dict) and isinstance(detail.get("base"), dict):
            simap_candidates.append(_text(detail["base"].get("pubType")).lower())
        for pub_type in simap_candidates:
            if pub_type in _SIMAP_CLOSED_PUB_TYPES:
                return f"simap:{pub_type}", f"pubType: {pub_type}"

        # TenderNed
        for block in (detail, listing, raw):
            if not isinstance(block, dict):
                continue
            pub_type_obj = block.get("typePublicatie")
            if isinstance(pub_type_obj, dict):
                tn_code = _text(pub_type_obj.get("code")).upper()
                if tn_code in _TENDERNED_CLOSED_TYPES:
                    return f"tenderned:{tn_code.lower()}", f"typePublicatie.code: {tn_code}"
            pub_code_obj = block.get("publicatiecode")
            if isinstance(pub_code_obj, dict):
                ef_code = _text(pub_code_obj.get("code")).upper()
                if ef_code in _TENDERNED_CLOSED_EFORMS:
                    return f"tenderned:{ef_code.lower()}", f"publicatiecode.code: {ef_code}"

        # France BOAMP
        if "idweb" in raw or "dateparution" in raw:
            nature = _text(raw.get("nature")).upper()
            if nature in _BOAMP_CLOSED_NATURES:
                return f"boamp:{nature.lower()}", f"nature: {nature}"

    return None


def build_closed_lifecycle_decision(code: str, quote: str) -> ScreeningDecision:
    """Build a zero-cost structured exclusion decision for an already-closed official notice."""
    return ScreeningDecision(
        decision="exclude",
        relevance_score=0,
        summary_zh=f"官方结构化状态标明公告已授标、直接授予或取消（{code}），无公开参与途径。",
        summary_en=(
            f"Official structured notice status ({code}) indicates award, direct award, "
            "post-award modification or cancellation with no open participation."
        ),
        reasons_zh=[f"官方状态代码为 {code}，不再开放参与。"],
        reasons_en=[f"Official lifecycle code {code} indicates no open participation."],
        missing_information=[],
        evidence=[Evidence(field="notice_text", quote=quote)],
        extracted_fields=[],
        notice_details=[],
    )
