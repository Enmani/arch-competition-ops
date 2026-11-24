"""Validate model claims at the source boundary before writing normalized facts."""

from __future__ import annotations

import json
import re
from datetime import date
from urllib.parse import urlsplit

from arch_competition_ops.config_loader import load_taxonomy
from arch_competition_ops.countries import is_generic_jurisdiction, resolve_record_country
from arch_competition_ops.location import get_country_label_for_jurisdiction
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date, slash_order_for_jurisdiction
from arch_competition_ops.normalizers.money import MONEY_NUMBER_PATTERN, parse_money_number
from arch_competition_ops.screening.models import ScreeningDecision, source_quote
from arch_competition_ops.screening.notice_urls import stored_link
from arch_competition_ops.settings import Settings

_URL_FIELDS = {"official_url", "brief_pdf_url", "documents_portal_url"}
_BOOL_FIELDS = {"licensed_architect_required", "local_partner_required"}
_MONEY_FIELDS = {"registration_fee_eur", "submission_fee_eur", "estimated_contract_value_eur"}
_LIST_FIELDS = {
    "competition_types",
    "project_types",
    "building_categories",
    "design_scopes",
    "project_modes",
    "audience",
    "languages",
}
_TAXONOMY = {
    "opportunity_type": "opportunity_types",
    "procedure_type": "procedure_types",
    "implementation_path": "implementation_paths",
    "jurisdiction": "regions",
}


class NoticeValidationError(ValueError):
    """A source-grounded record could not be produced from this particular notice."""


def extract_record(
    decision: ScreeningDecision,
    evidence_fields: dict[str, str],
    *,
    original_links: dict[str, set[str]] | None = None,
    source: SourceDefinition,
    source_url: str,
    settings: Settings,
) -> tuple[CompetitionRecord, list[str]]:
    source_url, source_redacted = stored_link(source_url)
    updates: dict = {}
    warnings: list[str] = []
    evidence_notes: list[str] = []
    if source_redacted:
        evidence_notes.append("Source URL: credential-like parameters removed.")
    taxonomy = load_taxonomy(settings)
    seen: set[str] = set()
    for claim in decision.extracted_fields:
        field, value, quote = claim.field, claim.value.strip(), claim.quote
        evidence = evidence_fields.get(claim.evidence_field, "")
        original_quote = source_quote(quote, evidence)
        if (
            field in seen
            or not claim.evidence_field.startswith("notice_")
            or original_quote is None
        ):
            warnings.append(f"{field}: missing, duplicated or unsupported source quote")
            continue
        seen.add(field)
        quote = original_quote
        claim.quote = quote
        converted: object = value
        valid = True
        if field in _URL_FIELDS:
            parts = urlsplit(value)
            valid = (
                parts.scheme in {"http", "https"}
                and bool(parts.hostname)
                and not parts.username
                and not parts.password
                and value in evidence_fields.get("notice_links", "").splitlines()
            )
            if source.collector != "generic_notice_pages" and value.rstrip(
                "/"
            ) == source.base_url.rstrip("/"):
                valid = False  # The source's collection/landing URL is not a project website.
            if valid and original_links is not None:
                originals = original_links.get(value, set())
                resolved = {stored_link(link) for link in originals}
                targets = {url for url, _ in resolved}
                valid = len(targets) == 1
                if valid:
                    converted = targets.pop()
                    if any(redacted for _, redacted in resolved):
                        evidence_notes.append(f"{field}: credential-like parameters removed.")
        elif field in _MONEY_FIELDS:
            amount = parse_money_number(value)
            cited = [parse_money_number(token) for token in MONEY_NUMBER_PATTERN.findall(quote)]
            valid = (
                amount is not None
                and re.fullmatch(r"\d+(?:\.\d+)?", value) is not None
                and amount >= 0
                and amount in cited
                and bool(re.search(r"€|\bEUR\b|\beuros?\b", quote, re.I))
            )
            converted = amount
        elif field == "deadline_at":
            try:
                converted = date.fromisoformat(value)
            except ValueError:
                valid = False
            parsed = parse_date(
                quote, slash_order=slash_order_for_jurisdiction(source.jurisdiction)
            )
            if parsed is not None:
                valid = valid and parsed == converted
            elif re.search(r"\b\d{1,2}/\d{1,2}/\d{4}\b", quote):
                valid = False
        elif field in _BOOL_FIELDS:
            valid = value in {"true", "false"}
            converted = value == "true"
        elif field in _TAXONOMY:
            valid = value in getattr(taxonomy, _TAXONOMY[field])
        elif field in _LIST_FIELDS:
            try:
                converted = json.loads(value)
                valid = (
                    isinstance(converted, list)
                    and bool(converted)
                    and all(
                        isinstance(label, str) and label in getattr(taxonomy, field)
                        for label in converted
                    )
                )
            except ValueError:
                valid = False
        else:
            original_value = source_quote(value, quote)
            valid = original_value is not None
            converted = original_value
        if not valid:
            warnings.append(f"{field}: value not supported by the cited source")
            continue
        updates[field] = converted
        evidence_notes.append(f"AI {field} [{source_url}]: {quote}")
    title = updates.pop("title", "")
    place_components = [updates.pop("location_city", None), updates.pop("location_region", None)]
    if not title:
        raise NoticeValidationError("AI could not extract a source-grounded project title")
    record = CompetitionRecord(
        title=title,
        source_url=source_url,
        source_id=source.source_id,
        source_name=source.name,
        jurisdiction=source.jurisdiction,
        regions=source.regions,
        languages=source.languages,
        evidence_level="official_notice" if source.source_tier == "primary" else "secondary",
    )
    record = CompetitionRecord.model_validate({**record.model_dump(), **updates})
    # A multi-country source (TED, the Islamic Development Bank) leaves "eu" or "global" unless the
    # model happened to pick a country from its short list; the notice itself names the country.
    # Without one, geocoding, the outline and the card's country code all silently give up.
    if is_generic_jurisdiction(record.jurisdiction):
        country = resolve_record_country(
            title=record.title,
            location_labels=[*place_components, record.location_label],
            notice_text=evidence_fields.get("notice_text"),
        )
        if country:
            record.jurisdiction = country
    record.geocode_queries = list(
        dict.fromkeys(
            filter(
                None,
                [
                    *place_components,
                    get_country_label_for_jurisdiction(record.jurisdiction),
                ],
            )
        )
    )
    record.evidence_note = (
        "\n".join(
            filter(
                None,
                [record.evidence_note, *evidence_notes, *(f"AI review: {w}" for w in warnings)],
            )
        )
        or None
    )
    if warnings:
        decision.missing_information.extend(warnings)
    return record, warnings
