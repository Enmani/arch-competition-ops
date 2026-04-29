from __future__ import annotations

from collections.abc import Callable

from arch_competition_ops.extractors.anac import parse_bdncp_notice
from arch_competition_ops.extractors.boamp import parse_boamp_notice
from arch_competition_ops.extractors.buyer_profile import parse_buyer_profile_notice
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice
from arch_competition_ops.extractors.scp import parse_procurement_hub_notice
from arch_competition_ops.extractors.simap import parse_simap_notice
from arch_competition_ops.extractors.ted import parse_ted_notice
from arch_competition_ops.models import CompetitionRecord, SourceDefinition

Parser = Callable[[str, SourceDefinition, str], CompetitionRecord]

PARSERS: dict[str, Parser] = {
    "ted_notice_parser": parse_ted_notice,
    "boamp_notice_parser": parse_boamp_notice,
    "simap_notice_parser": parse_simap_notice,
    "bdncp_notice_parser": parse_bdncp_notice,
    "procurement_hub_parser": parse_procurement_hub_notice,
    "buyer_profile_parser": parse_buyer_profile_notice,
    "generic_listing_html": parse_generic_listing_notice,
}


def get_parser(extractor_name: str) -> Parser:
    parser = PARSERS.get(extractor_name)
    if parser is None:
        raise KeyError(f"No parser registered for extractor '{extractor_name}'")
    return parser


def parse_source_payload(
    source: SourceDefinition,
    payload: str,
    *,
    source_url: str | None = None,
) -> CompetitionRecord:
    parser = get_parser(source.extractor)
    return parser(payload, source, source_url or source.base_url)
