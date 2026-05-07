import json

from arch_competition_ops.geocoding import NominatimGeocoder, enrich_record_geocode
from arch_competition_ops.location import infer_location_label
from arch_competition_ops.models import CompetitionRecord


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload

    def raise_for_status(self):
        return None


class FakeSession:
    def __init__(self):
        self.urls = []

    def get(self, url, *, headers, timeout):
        self.urls.append(url)
        assert "User-Agent" in headers
        assert timeout == 15
        return FakeResponse(
            [
                {
                    "address": {"village": "Maur"},
                    "class": "place",
                    "importance": 0.58,
                    "lat": "47.3407",
                    "lon": "8.6710",
                    "type": "village",
                }
            ]
        )


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
    session = FakeSession()
    geocoder = NominatimGeocoder(
        cache_path=tmp_path / "geocoding-cache.json",
        min_interval_seconds=0,
        session=session,
    )
    record = CompetitionRecord(
        title="Extension du complexe sportif et de loisirs Looren, 8124 Maur",
        organizer="simap Swiss Public Procurement",
        authority_name="Gemeindeverwaltung Maur",
        source_url="https://www.simap.ch/example",
        jurisdiction="switzerland",
    )

    enriched = enrich_record_geocode(
        record,
        cache_path=tmp_path / "geocoding-cache.json",
        geocoder=geocoder,
    )

    assert enriched.location_label == "Maur"
    assert enriched.geo_lat == 47.3407
    assert enriched.geo_lng == 8.671
    assert enriched.geo_source == "nominatim"
    assert enriched.geo_confidence is not None
    assert len(session.urls) == 1
    assert "countrycodes=ch" in session.urls[0]

    second_record = CompetitionRecord(
        title="Another notice, 8124 Maur",
        organizer="simap Swiss Public Procurement",
        source_url="https://www.simap.ch/another",
        jurisdiction="switzerland",
        location_label="Maur",
    )
    enrich_record_geocode(
        second_record,
        cache_path=tmp_path / "geocoding-cache.json",
        geocoder=geocoder,
    )

    assert len(session.urls) == 1
    cache_payload = json.loads((tmp_path / "geocoding-cache.json").read_text(encoding="utf-8"))
    assert cache_payload["entries"]["switzerland:maur"]["lat"] == 47.3407
