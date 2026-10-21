from __future__ import annotations

import json
import logging

from http_fakes import Reply, make_client

from arch_competition_ops.geocoding import NominatimGeocoder, enrich_record_geocode
from arch_competition_ops.location import infer_location_label
from arch_competition_ops.models import CompetitionRecord

MAUR_RESULT = [
    {
        "address": {"village": "Maur"},
        "class": "place",
        "importance": 0.58,
        "lat": "47.3407",
        "lon": "8.6710",
        "type": "village",
    }
]


def _maur_reply() -> Reply:
    return Reply(
        body=json.dumps(MAUR_RESULT).encode(), headers={"Content-Type": "application/json"}
    )


def _record(**overrides) -> CompetitionRecord:
    values = {
        "title": "Extension du complexe sportif et de loisirs Looren, 8124 Maur",
        "organizer": "",
        "authority_name": "Gemeindeverwaltung Maur",
        "source_url": "https://www.simap.ch/example",
        "jurisdiction": "switzerland",
    }
    values.update(overrides)
    return CompetitionRecord(**values)


def test_infer_location_label_prefers_explicit_title_tail() -> None:
    assert (
        infer_location_label(
            authority_name="Gemeindeverwaltung Maur",
            title="Extension du complexe sportif et de loisirs Looren, 8124 Maur",
        )
        == "Maur"
    )


def test_infer_location_label_handles_project_and_commune_phrases() -> None:
    assert (
        infer_location_label(
            authority_name="Suelo y Vivienda de Aragón, S.L.U.",
            title="Proyecto y dirección de obra de Fuentespalda",
        )
        == "Fuentespalda"
    )
    assert (
        infer_location_label(
            authority_name="Société du Canal de Provence",
            title=(
                "Mission de Maîtrise d'oeuvre pour la réalisation des travaux, "
                "sur la commune de Peyrolles-en-Provence"
            ),
        )
        == "Peyrolles-en-Provence"
    )


def test_enrich_record_geocode_uses_nominatim_cache(tmp_path) -> None:
    client, adapter, _clock = make_client([_maur_reply()])
    cache_path = tmp_path / "geocoding-cache.json"
    geocoder = NominatimGeocoder(cache_path=cache_path, client=client)

    enriched = enrich_record_geocode(_record(), cache_path=cache_path, geocoder=geocoder)

    assert enriched.location_label == "Maur"
    assert enriched.geo_lat == 47.3407
    assert enriched.geo_lng == 8.671
    assert enriched.geo_source == "nominatim"
    assert enriched.geo_confidence is not None
    assert len(adapter.requests) == 1
    assert "countrycodes=ch" in adapter.requests[0].url

    second_record = _record(
        title="Another notice, 8124 Maur",
        authority_name=None,
        source_url="https://www.simap.ch/another",
        location_label="Maur",
    )
    enrich_record_geocode(second_record, cache_path=cache_path, geocoder=geocoder)
    assert len(adapter.requests) == 1  # second lookup came from the in-memory cache

    geocoder.flush()
    cache_payload = json.loads(cache_path.read_text(encoding="utf-8"))
    assert cache_payload["entries"]["switzerland:maur"]["lat"] == 47.3407


def test_cache_is_written_in_batches_and_flushed_atomically(tmp_path) -> None:
    client, _adapter, _clock = make_client(lambda _request: _maur_reply())
    cache_path = tmp_path / "geocoding-cache.json"
    geocoder = NominatimGeocoder(cache_path=cache_path, client=client, save_every=3)

    for label in ("Maur", "Uster"):
        geocoder.geocode(location_label=label, jurisdiction="switzerland")
    assert not cache_path.exists()  # below the save threshold: no per-lookup rewrite

    geocoder.geocode(location_label="Zurich", jurisdiction="switzerland")
    assert cache_path.exists()  # threshold reached

    geocoder.geocode(location_label="Winterthur", jurisdiction="switzerland")
    geocoder.flush()
    entries = json.loads(cache_path.read_text(encoding="utf-8"))["entries"]
    assert set(entries) == {
        "switzerland:maur",
        "switzerland:uster",
        "switzerland:zurich",
        "switzerland:winterthur",
    }
    assert not list(tmp_path.glob("*.tmp"))  # temp files are replaced, never left behind


def test_corrupt_cache_is_reported_and_kept_aside(tmp_path, caplog) -> None:
    cache_path = tmp_path / "geocoding-cache.json"
    cache_path.write_text('{"version": 1, "entries": {', encoding="utf-8")
    client, _adapter, _clock = make_client([])

    with caplog.at_level(logging.WARNING, logger="arch_competition_ops.geocoding"):
        geocoder = NominatimGeocoder(cache_path=cache_path, client=client)

    assert geocoder._cache == {}
    assert any("unreadable" in message for message in caplog.messages)
    assert (
        (tmp_path / "geocoding-cache.json.corrupt")
        .read_text(encoding="utf-8")
        .startswith('{"version"')
    )
    assert not cache_path.exists()


def test_unexpected_cache_version_is_reported_and_ignored(tmp_path, caplog) -> None:
    cache_path = tmp_path / "geocoding-cache.json"
    cache_path.write_text(json.dumps({"version": 99, "entries": {"x": None}}), encoding="utf-8")
    client, _adapter, _clock = make_client([])

    with caplog.at_level(logging.WARNING, logger="arch_competition_ops.geocoding"):
        geocoder = NominatimGeocoder(cache_path=cache_path, client=client)

    assert geocoder._cache == {}
    assert any("unexpected structure or version" in message for message in caplog.messages)


def test_http_failure_is_not_cached_as_not_found(tmp_path) -> None:
    client, adapter, _clock = make_client(
        [Reply(status=429, headers={"Retry-After": "0"})] * 3 + [_maur_reply()]
    )
    cache_path = tmp_path / "geocoding-cache.json"
    geocoder = NominatimGeocoder(cache_path=cache_path, client=client)

    record = enrich_record_geocode(_record(), cache_path=cache_path, geocoder=geocoder)
    assert record.geo_lat is None  # rate-limited: enrichment gives up quietly for this record
    assert geocoder._cache == {}  # ... and does not remember "no result"

    retry = enrich_record_geocode(_record(), cache_path=cache_path, geocoder=geocoder)
    assert retry.geo_lat == 47.3407
    assert len(adapter.requests) == 4
