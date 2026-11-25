"""Validate model claims at the source boundary before writing normalized facts."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime
from urllib.parse import urlsplit

from arch_competition_ops.config_loader import load_taxonomy
from arch_competition_ops.countries import is_generic_jurisdiction, resolve_record_country
from arch_competition_ops.location import get_country_label_for_jurisdiction
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date, slash_order_for_jurisdiction
from arch_competition_ops.normalizers.money import MONEY_NUMBER_PATTERN, parse_money_number
from arch_competition_ops.screening.field_contract import FIELDS
from arch_competition_ops.screening.models import ScreeningDecision
from arch_competition_ops.screening.notice_urls import stored_link
from arch_competition_ops.settings import Settings


def _label(value, allowed):
    if not isinstance(value, str):
        return None
    if value in allowed:
        return value
    key = "_".join(value.casefold().split())
    return next((label for label in allowed if "_".join(label.casefold().split()) == key), None)


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
        if field in seen:
            warnings.append(f"{field}: duplicate extracted field")
            continue
        seen.add(field)
        converted: object = value
        valid = True
        spec = FIELDS[field]
        if spec.kind == "url":
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
        elif spec.kind == "money":
            amount = float(value) if re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", value) else None
            cited = [parse_money_number(token) for token in MONEY_NUMBER_PATTERN.findall(quote)]
            valid = (
                amount is not None
                and math.isfinite(amount)
                and amount in cited
                and bool(re.search(r"€|\bEUR\b|\beuros?\b", quote, re.I))
            )
            converted = amount
        elif spec.kind == "date":
            try:
                # Store the buyer's calendar day, including when the model copied an ISO time.
                converted = datetime.fromisoformat(value).date()
            except ValueError:
                converted = None
            valid = converted is not None and converted == parse_date(
                quote, slash_order=slash_order_for_jurisdiction(source.jurisdiction)
            )
        elif spec.kind == "bool":
            valid = value in {"true", "false"}
            converted = value == "true"
        elif spec.kind == "label":
            converted = _label(value, getattr(taxonomy, spec.taxonomy))
            valid = converted is not None
        elif spec.kind == "label-list":
            try:
                labels = json.loads(value)
            except ValueError:
                labels = None
            allowed = getattr(taxonomy, spec.taxonomy)
            converted = (
                [_label(label, allowed) for label in labels] if isinstance(labels, list) else []
            )
            valid = bool(converted) and None not in converted
        elif spec.kind == "text":
            converted = quote
        else:
            raise AssertionError(f"Unhandled field kind {spec.kind}")
        if not valid:
            warnings.append(f"{field}: value not supported by the cited source")
            continue
        updates[field] = converted
        evidence_notes.append(f"AI {field} [{source_url}]: {quote}")
    title = updates.pop("title", "")
    if (original := evidence_fields.get("notice_title")) and original != title:
        title = original
        evidence_notes.append(f"Original notice title [{source_url}]: {title}")
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
