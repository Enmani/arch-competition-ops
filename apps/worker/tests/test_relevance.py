from __future__ import annotations

import pytest

from arch_competition_ops.collectors.relevance import (
    has_built_environment_context,
    is_design_relevant,
)
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


def test_chinese_design_notices_are_relevant() -> None:
    assert is_design_relevant("建筑设计 招标")
    assert is_design_relevant("某医院室内设计项目")
    assert not is_design_relevant("道路养护工程 招标")


def test_student_housing_architecture_is_not_mistaken_for_a_student_competition() -> None:
    assert is_design_relevant("Student housing architecture competition")
    assert is_design_relevant("Studentenwohnheim Neubau Architektur Wettbewerb planungswettbewerb")


@pytest.mark.parametrize(
    "text",
    [
        "Student competition for an architecture pavilion",
        "Students only: architecture workshop",
        "Architecture awards ceremony 2026",
        "Contract award notice for architectural services",
        "Poster design competition",
        "Logo design for the architecture office",
    ],
)
def test_genuinely_out_of_scope_notices_stay_excluded(text: str) -> None:
    assert not is_design_relevant(text)


def test_negative_markers_no_longer_fire_on_substrings() -> None:
    assert is_design_relevant("Progettazione architettura scuola catalogo")  # 'logo' in 'catalogo'
    assert is_design_relevant("Posterior wing extension architecture competition")  # 'poster'
    assert is_design_relevant("Landscape architecture rewarding public space")  # 'award'-like stems


def test_maitrise_d_oeuvre_matches_once_normalized() -> None:
    assert is_design_relevant("Mission de maîtrise d'oeuvre pour un collège")
    assert is_design_relevant("MISSION DE MAITRISE D'OEUVRE")


def test_maitrise_d_ouvrage_alone_is_not_a_design_signal() -> None:
    # Client-side project management appears in nearly every French notice.
    assert not is_design_relevant("Assistance à maîtrise d'ouvrage pour la gestion des déchets")


def test_cpv_codes_still_rescue_otherwise_unmarked_titles() -> None:
    assert is_design_relevant("Servizi tecnici", cpv_codes=["71240000"])
    assert not is_design_relevant("Servizi tecnici", cpv_codes=["50000000"])


def test_category_labels_decide_student_and_professional_scope() -> None:
    assert not is_design_relevant("Architecture competition", categories=["For students"])
    assert is_design_relevant(
        "Architecture competition", categories=["For students", "For professionals"]
    )
    assert not is_design_relevant(
        "Architecture competition", categories=["Open"], require_professional_category=True
    )
    assert is_design_relevant(
        "Architecture competition",
        categories=["For professionals"],
        require_professional_category=True,
    )


def test_built_environment_context_understands_chinese() -> None:
    assert has_built_environment_context("某学校教学楼改造")
    assert not has_built_environment_context("软件系统运维服务")
