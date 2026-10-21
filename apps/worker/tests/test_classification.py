from __future__ import annotations

import json

import pytest
from support import build_source

from arch_competition_ops.extractors import parse_source_payload
from arch_competition_ops.extractors.classification import infer_building_categories


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Extension du complexe sportif et de loisirs Looren", ["sport_leisure"]),
        ("New stadium and arena for the city", ["sport_leisure"]),
        ("Restauro conservativo del museo civico", ["culture_heritage"]),
        ("Archaeological park heritage centre", ["culture_heritage"]),
        ("Rail station passenger access upgrade", ["transport_infrastructure"]),
        ("Bridge and tunnel refurbishment", ["transport_infrastructure"]),
        ("Hospital and school campus", ["education", "healthcare"]),
        ("Neubau Rathaus und Bibliothek", ["civic_public"]),
        ("Wohnbauten Quartier", ["housing"]),
    ],
)
def test_keyword_categories_cover_sport_culture_and_transport(text, expected) -> None:
    assert infer_building_categories([], text=text) == expected


def test_stems_match_at_word_start_only() -> None:
    # "transport" contains "sport"; it is a transport project, not a sports one.
    assert infer_building_categories([], text="Transport interchange") == [
        "transport_infrastructure"
    ]
    assert infer_building_categories([], text="Unrelated hostel") == []


def test_competition_types_still_imply_their_categories() -> None:
    assert infer_building_categories(
        ["healthcare", "education", "housing", "public_building"], text=""
    ) == ["education", "healthcare", "housing", "civic_public"]


def test_explicit_categories_win_over_inference() -> None:
    assert infer_building_categories(
        ["healthcare"], building_categories=["housing"], text="museum"
    ) == ["housing"]


def test_ingested_records_get_the_extra_categories() -> None:
    source = build_source(
        "gets_open_tenders",
        name="Example",
        jurisdiction="switzerland",
        base_url="https://example.invalid/",
        scan_method="api",
        extractor="generic_listing_html",
        collector="generic_rss_feed",
    )
    payload = json.dumps(
        {
            "title": "Extension du complexe sportif et de loisirs Looren, 8124 Maur",
            "buyer": "Gemeindeverwaltung Maur",
        }
    )

    record = parse_source_payload(source, payload)

    assert record.building_categories == ["sport_leisure"]
