from __future__ import annotations

from arch_competition_ops.normalizers.text import (
    compile_markers,
    contains_phrase,
    normalize_text,
)


def test_normalize_text_keeps_cjk_and_folds_latin_accents() -> None:
    assert normalize_text("建筑设计 招标公告") == "建筑设计 招标公告"
    assert normalize_text("Maîtrise d'œuvre – Bibliothèque") == "maitrise d oeuvre bibliotheque"
    assert normalize_text("Straße / Größe") == "strasse grosse"
    assert normalize_text(None) == ""
    assert normalize_text("   ") == ""


def test_markers_are_normalized_so_accented_phrases_can_match() -> None:
    (marker,) = compile_markers(["maîtrise d'oeuvre"])

    assert marker == "maitrise d oeuvre"
    assert contains_phrase(normalize_text("Mission de MAÎTRISE D'OEUVRE complète"), marker)


def test_phrase_matching_respects_word_boundaries_for_latin_text_only() -> None:
    assert contains_phrase("catalogo grafica", "grafica")
    assert not contains_phrase("catalogo", "logo")
    assert not contains_phrase("posterior view", "poster")
    assert contains_phrase("poster competition", "poster")
    assert contains_phrase("建筑设计招标", "建筑设计")  # CJK has no spaces between words
