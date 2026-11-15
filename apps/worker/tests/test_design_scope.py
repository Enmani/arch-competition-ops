from __future__ import annotations

import pytest

from arch_competition_ops.collectors.design_scope import (
    DESCRIPTION_CHARS,
    SCOPE_CPV_PREFIXES,
    SCOPE_CPV_ROOT_CODES,
    SCOPE_CPV_ROOT_CODES_WITH_CHECK_DIGIT,
    WORKS_CPV_ROOT_CODE,
    WORKS_CPV_ROOT_CODE_WITH_CHECK_DIGIT,
    has_design_cpv,
    is_design_and_build,
)


def test_scope_codes_agree_with_each_other():
    assert SCOPE_CPV_PREFIXES == ("71", "7993")
    assert all(code.startswith(SCOPE_CPV_PREFIXES) for code in SCOPE_CPV_ROOT_CODES)
    assert [code.split("-")[0] for code in SCOPE_CPV_ROOT_CODES_WITH_CHECK_DIGIT] == list(
        SCOPE_CPV_ROOT_CODES
    )
    assert WORKS_CPV_ROOT_CODE_WITH_CHECK_DIGIT.split("-")[0] == WORKS_CPV_ROOT_CODE


def test_has_design_cpv_reads_main_and_additional_codes():
    assert has_design_cpv(["45000000", "71240000"])
    assert has_design_cpv(["79932000"])
    assert not has_design_cpv(["45000000", "79900000"])
    assert not has_design_cpv([])


@pytest.mark.parametrize(
    "title",
    [
        # Live titles seen dropped before the design-and-build scope existed (2026-11).
        "Marché public global sectoriel de conception-réalisation du Nouvel Hôpital Jean Verdier",
        "Appalto integrato per la progettazione esecutiva ed esecuzione dei lavori",
        "Affidamento congiunto della progettazione e dell'esecuzione dei lavori",
        "2026/5388 - 1148703 NTNU Campussamling - K206 - Samspillsentreprise",
        "26278 Heer barnehage – Ombygging, nytt bygg og utomhusarbeider, totalentreprise",
        "Bouwkundig aannemer bouwteam realisatie IKC Oost te Brunssum",
        "Design & Build Sport- en beweegcentrum Schenkel",
        "Marché Global de Performance sur les bâtiments communaux",
        "Design-build of a fire station",
        "Design and Construct contract for the new depot",
        "Udbud af kontrakt om totalentreprise af FGU-Skole",
        "Ny skola i totalentreprenad",
        "Totalunternehmerleistungen Neubau Schulhaus",
        "Generalübernehmer Neubau Kita",
        "Planen und Bauen einer Sporthalle",
        "Vergabe von Planungs- und Bauleistungen für den Ersatzneubau",
        "Gesamtleistungssubmission Neubau Werkhofsgebäude, Birmenstorf",
        "Appel d'offres en entreprise totale",
        "UAV-GC contract N201",
        "Geïntegreerd contract renovatie stadhuis",
        "Contrato mixto de redacción del proyecto básico y de ejecución y ejecución de las obras",
        "Elaboración de proyecto y ejecución de obra del nuevo CEIP",
        "Empreitada de conceção-construção do novo Centro de Saúde",
        "Generalne wykonawstwo w formule zaprojektuj i wybuduj",
        "Zaprojektowanie i wykonanie robót budowlanych",
        "Piikkiön yhtenäiskoulun KVR-urakka",
        "Proiectare și execuție lucrări pentru Parc Lac",
        "Tervezési és kivitelezési munkák",
    ],
)
def test_names_an_integrated_design_and_build_contract(title):
    assert is_design_and_build(title)


@pytest.mark.parametrize(
    "title",
    [
        # Builds an already-designed project: not a target.
        "Ejecución de las obras de reforma del colegio según el Proyecto Básico y de Ejecución",
        "Servicio de redacción del proyecto básico",
        "Coordinamento della sicurezza in fase di progettazione ed esecuzione",
        "Design-bid-build general contractor",
        "Generalunternehmer Neubau Kita",
        "Planung und Bauüberwachung",
        "Gesamtleistung 500 kW Photovoltaik",
        "Lambertseter skole - utførelsesentreprise",
        "Construction work for school buildings",
        "Interior design and building works supervision",
        "Marché de réalisation des travaux de voirie",
        "Execuție lucrări pentru proiectul Amenajare Parc",
        # Live BOAMP and ANAC titles (2026-11) that are no building contract.
        "Conception, réalisation et installation d'une œuvre d'art - 1% artistique",
        "Conception, réalisation, montage et démontage du stand sur Santexpo 2027",
        "Fornitura di materiali di progettazione e costruzione",
    ],
)
def test_ignores_plain_works_and_design_only_wording(title):
    assert not is_design_and_build(title)


def test_reads_the_description_only_up_to_its_first_characters():
    assert is_design_and_build("Nieuwbouw school", "Uitvoering in bouwteam.")
    late = "x " * DESCRIPTION_CHARS + "Uitvoering in bouwteam."
    assert not is_design_and_build("Nieuwbouw school", late)


def test_matches_on_word_boundaries():
    assert not is_design_and_build("Redesign building envelope")
    assert not is_design_and_build("Nonbouwteam")
    assert is_design_and_build(None, "Totalentreprisen omfatter prosjektering og bygging.")
