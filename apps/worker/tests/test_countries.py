from __future__ import annotations

import json
import sqlite3

from http_fakes import Reply, make_client
from support import REPO_ROOT

from arch_competition_ops.countries import (
    country_registry,
    is_generic_jurisdiction,
    resolve_country_from_iso3,
    resolve_country_from_text,
    resolve_record_country,
)
from arch_competition_ops.geocoding import NominatimGeocoder, enrich_record_geocode
from arch_competition_ops.location import (
    get_country_code_for_jurisdiction,
    get_country_label_for_jurisdiction,
)
from arch_competition_ops.maintenance import repair_record_jurisdictions
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import ensure_schema, upsert_competition


def test_the_registry_covers_countries_outside_the_products_own_list() -> None:
    registry = country_registry()
    assert registry["uganda"]["iso2"] == "UG"
    assert registry["cote_d_ivoire"]["iso3"] == "CIV"
    assert registry["germany"]["iso2"] == "DE", "no deprecated East Germany code"
    assert len(registry) > 200
    assert is_generic_jurisdiction("EU") and is_generic_jurisdiction("global")
    assert is_generic_jurisdiction(None) and not is_generic_jurisdiction("germany")


def test_the_worker_copy_of_the_registry_is_the_one_the_web_app_uses() -> None:
    web = REPO_ROOT / "packages" / "previews" / "data" / "countries.json"
    worker = (
        REPO_ROOT / "apps" / "worker" / "src" / "arch_competition_ops" / "data" / "countries.json"
    )
    assert worker.read_bytes() == web.read_bytes(), (
        "run `npm run build:countries -w @arch-competition/previews`"
    )


def test_any_registry_country_has_a_geocoder_label_and_code() -> None:
    # Until now only 40 jurisdictions did; every other country silently skipped geocoding.
    assert get_country_label_for_jurisdiction("uganda") == "Uganda"
    assert get_country_code_for_jurisdiction("uganda") == "ug"
    assert get_country_code_for_jurisdiction("germany") == "de"
    assert get_country_label_for_jurisdiction("global") is None
    assert get_country_code_for_jurisdiction("eu") is None


def test_text_resolves_to_a_country_the_way_the_web_side_does() -> None:
    cases = {
        "Côte d’Ivoire": "cote_d_ivoire",
        "à Nouakchott, en Mauritanie": "mauritania",
        "Kampala, Uganda": "uganda",
        "Ankara, Türkiye": "turkiye",
        "Istanbul, Turkey": "turkiye",
        "北京市丰台区, 中国": "china",
        "乌干达阿鲁阿": "uganda",
        # Short, shared or running-text names say nothing.
        "Romano d'Ezzelino": None,
        "Congo": None,
        "Georgia": None,
        "Municipiul Craiova": None,
        "Erfurter Str. 30-26": None,
        "": None,
    }
    for text, expected in cases.items():
        assert resolve_country_from_text(text) == expected, text


def test_ted_structured_place_of_performance_is_read_first() -> None:
    notice = (
        '{"placeOfPerformance": ["DEE06", "DEU", "DEE06", "DEU"], "buyer": "Landesbetrieb"} '
        "Place of performance Country : Austria"
    )
    assert resolve_country_from_iso3("DEU") == "germany"
    assert resolve_record_country(title="Burg", notice_text=notice) == "germany"


def test_the_listing_country_field_and_the_notice_text_are_read() -> None:
    assert (
        resolve_record_country(
            title="Establishment of Regional Oncology Centers in Arua and Mbale - GPN",
            location_labels=["Arua and Mbale"],
            notice_text='{"country": "Uganda", "title": "Establishment of Regional Oncology"}',
        )
        == "uganda"
    )
    text = (
        "2.1.2. Place of performance Country : Côte d’Ivoire Additional information : "
        "Les prestations se déroulent à San Pedro"
    )
    assert resolve_record_country(notice_text=text) == "cote_d_ivoire"


def test_place_names_then_the_title_lead_are_the_fallback_and_only_the_lead_is_read() -> None:
    assert resolve_record_country(location_labels=["Bad Ischl", None], title=None) is None
    assert (
        resolve_record_country(location_labels=["Bad Ischl"], title="Austria – Works for complete")
        == "austria"
    )
    assert (
        resolve_record_country(location_labels=["Kampala, Uganda"], title="France – Survey")
        == "uganda"
    )
    # A country named later in the title is the subject, not the place.
    assert (
        resolve_record_country(title="Generalplanerleistungen for Germany", location_labels=[])
        is None
    )


def test_a_country_outside_the_old_list_is_now_geocoded_inside_that_country(tmp_path) -> None:
    reply = Reply(
        body=json.dumps(
            [
                {
                    "address": {"city": "Arua", "country_code": "ug"},
                    "class": "place",
                    "importance": 0.5,
                    "lat": "3.02",
                    "lon": "30.91",
                    "type": "city",
                }
            ]
        ).encode(),
        headers={"Content-Type": "application/json"},
    )
    client, adapter, _clock = make_client([reply])
    cache_path = tmp_path / "geocoding-cache.json"
    record = CompetitionRecord(
        title="Establishment of Regional Oncology Centers in Arua",
        source_url="https://example.org/1",
        jurisdiction="uganda",
        location_label="Arua",
        geocode_queries=["Arua", "Uganda"],
    )

    enriched = enrich_record_geocode(
        record,
        cache_path=cache_path,
        geocoder=NominatimGeocoder(cache_path=cache_path, client=client),
    )

    assert (enriched.geo_lat, enriched.geo_lng) == (3.02, 30.91)
    assert "countrycodes=ug" in adapter.requests[0].url


def _seed_screening_run(db_path, competition_id: str, notice_text: str) -> None:
    request = {"input": json.dumps({"evidence_fields": {"notice_text": notice_text}})}
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "INSERT INTO ai_screening_runs "
            "(id, competition_id, source_url, model, input_json, status, cost_usd, started_at) "
            "VALUES (?, ?, 'https://example.org/n', 'gpt-6-luna', ?, 'completed', 0, "
            "'2026-11-01T00:00:00+00:00')",
            (f"run-{competition_id}", competition_id, json.dumps(request)),
        )


def test_stored_records_get_their_country_and_stay_assessed(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(root=tmp_path)
    db_path = settings.resolve_path(settings.db)
    ensure_schema(db_path)
    ids = {
        "ted": upsert_competition(
            db_path,
            CompetitionRecord(
                competition_id="burg",
                title="Ersatzneubau Betriebsstelle Burg",
                source_url="https://example.org/ted",
                jurisdiction="eu",
                location_label="Burg",
            ),
        ),
        "isdb": upsert_competition(
            db_path,
            CompetitionRecord(
                competition_id="arua",
                title="Establishment of Regional Oncology Centers",
                source_url="https://example.org/isdb",
                jurisdiction="global",
            ),
        ),
        "none": upsert_competition(
            db_path,
            CompetitionRecord(
                competition_id="nowhere",
                title="Framework agreement",
                source_url="https://example.org/none",
                jurisdiction="global",
            ),
        ),
        "own": upsert_competition(
            db_path,
            CompetitionRecord(
                competition_id="paris",
                title="Paris – Étude",
                source_url="https://example.org/fr",
                jurisdiction="france",
            ),
        ),
    }
    _seed_screening_run(db_path, ids["ted"], '{"placeOfPerformance": ["DEE06", "DEU"]}')
    _seed_screening_run(db_path, ids["isdb"], '{"country": "Uganda"}')
    with sqlite3.connect(db_path) as connection:
        stamp = connection.execute(
            "SELECT updated_at FROM competitions WHERE id = ?", (ids["ted"],)
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO ai_screening_results "
            "(competition_id, source_updated_at, model, decision, relevance_score, result_json, "
            "updated_at) VALUES (?, ?, 'gpt-6-luna', 'recommend', 80, '{}', ?)",
            (ids["ted"], stamp, stamp),
        )

    result = repair_record_jurisdictions(settings, geocode=False)

    assert (result.scanned, result.repaired) == (3, 2)
    with sqlite3.connect(db_path) as connection:
        jurisdictions = dict(connection.execute("SELECT id, jurisdiction FROM competitions"))
        new_stamp = connection.execute(
            "SELECT updated_at FROM competitions WHERE id = ?", (ids["ted"],)
        ).fetchone()[0]
        assessed_at = connection.execute(
            "SELECT source_updated_at FROM ai_screening_results WHERE competition_id = ?",
            (ids["ted"],),
        ).fetchone()[0]
    assert jurisdictions == {
        ids["ted"]: "germany",
        ids["isdb"]: "uganda",
        ids["none"]: "global",
        ids["own"]: "france",
    }
    # The country was read from the notice already stored, so the assessment stays current.
    assert new_stamp != stamp and assessed_at == new_stamp
    # Running it again changes nothing.
    again = repair_record_jurisdictions(settings, geocode=False)
    assert (again.scanned, again.repaired) == (1, 0)
