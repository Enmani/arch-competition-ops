"""The AI-mode design scope shared by every official-notice collector.

In AI mode a collector reads its whole publication window and keeps only open-participation
notices that are in this scope; the triage and assessment models judge the rest. A notice is in
scope when it

* carries a CPV code (main or additional) under ``71`` (architectural, engineering and planning
  services) or ``7993`` (specialty design: interior, urban planning and landscape services);
* is a design contest, whatever its CPV codes (each source states that in its own field);
* carries no CPV code at all (unknown is not out of scope); or
* is an integrated design-and-build contract (``is_design_and_build``), whatever its CPV codes.
  Those usually carry only works codes (``45*``), but architects take part in them through
  contractor-led teams.

Collectors that filter CPV codes server-side send ``SCOPE_CPV_ROOT_CODES`` (or the spelling with
the check digit), and read open works notices (``WORKS_CPV_ROOT_CODE``) in one extra pass whose
titles go through ``is_design_and_build`` before any detail is fetched.

Design-and-build markers are matched on ``normalize_text`` output (lower case, Latin accents
folded, punctuation turned into single spaces, as in ``collectors.relevance``), on word
boundaries. A marker names the integrated procurement model itself (``conception-réalisation``,
``appalto integrato``, ``totalentreprise``...), never design or construction alone: a plain works
contract that builds an already-designed project (Spanish "ejecución de las obras del Proyecto
Básico y de Ejecución") is not a target. German, Dutch and Nordic markers are compound stems and
may be followed by more letters (``bouwteamovereenkomst``, ``totalentreprisen``).
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from arch_competition_ops.normalizers.text import normalize_text

SCOPE_CPV_PREFIXES = ("71", "7993")
# Root codes of the scope for APIs that match a code and its whole subtree.
SCOPE_CPV_ROOT_CODES = ("71000000", "79930000")
# The same roots with their CPV check digit (TenderNed's ``cpvCodes`` spelling).
SCOPE_CPV_ROOT_CODES_WITH_CHECK_DIGIT = ("71000000-8", "79930000-2")
# Construction work: the CPV division of the extra design-and-build pass.
WORKS_CPV_PREFIX = "45"
WORKS_CPV_ROOT_CODE = "45000000"
WORKS_CPV_ROOT_CODE_WITH_CHECK_DIGIT = "45000000-7"

# Only the start of a long description is read: the procurement model is stated up front, and a
# long text mentions design and building in passing far more often than it defines the contract.
DESCRIPTION_CHARS = 1000

_DESIGN_AND_BUILD_PATTERNS = (
    # French. Punctuation is gone after normalization, so "conception, réalisation et
    # installation d'une oeuvre d'art" or "... montage du stand" (art, exhibition stands, print)
    # read like "conception-réalisation"; the word that follows tells them apart.
    r"conceptions? (?:et )?realisations?"
    r"(?! (?:et )?(?:installation|montage|fabrication|impression|diffusion|animation)\b)",
    r"marches? globa(?:l|ux) (?:de performance|sectoriels?)",
    r"entreprise totale",
    r"entrepreneur total",
    # Italian. "In fase di progettazione ed esecuzione" is safety coordination, a service;
    # "materiali di progettazione e costruzione" is a supply.
    r"appalt[oi] integrat[oi]",
    r"(?<!fase di )(?<!sicurezza in )(?<!materiali di )progettazione"
    r"(?: definitiva| esecutiva| definitiva ed esecutiva| definitiva e esecutiva)?"
    r" (?:e|ed) (?:dell |della |la |l )?(?:esecuzione|realizzazione|costruzione)",
    r"impresa totale",
    # English
    r"design (?:and )?build",
    r"design (?:and )?construct",
    r"design and construction (?:of|contract)",
    # Dutch
    r"bouwteam\w*",
    r"uav ?gc",
    r"geintegreerde? contract\w*",
    r"ontwerp(?:en)? en (?:bouw|bouwen|realisatie|realiseren|uitvoering|uitvoeren)",
    r"dbfm\w*",
    # Norwegian, Danish, Swedish
    r"\w*totalentrepris\w*",
    r"\w*totalentreprenad\w*",
    r"samspillsentrepris\w*",
    r"samspillskontrakt\w*",
    # German (Germany, Austria, Switzerland)
    r"\w*totalunternehmer\w*",
    r"\w*generalu(?:e)?bernehmer\w*",
    r"planen und bauen",
    r"planungs und bauleistung\w*",
    r"planung und schlusselfertige errichtung",
    r"gesamtleistungs(?:wettbewerb|ausschreibung|submission|vergabe|studie|anbieter|vertrag)\w*",
    r"funktionale ausschreibung",
    r"leistungsbeschreibung mit leistungsprogramm",
    # Spanish and Catalan: only when drafting the project is part of the contract.
    r"(?:redaccion|elaboracion) (?:del?|de los) proyectos?(?: \S+){0,12}?"
    r" (?:ejecucion|construccion|realizacion) (?:de )?(?:las |la |los |sus )?obras?",
    r"redaccio del projecte(?: \S+){0,12}? execucio de (?:les )?obres?",
    # Portuguese
    r"conce(?:p)?cao (?:e )?construcao",
    r"proje(?:c)?to e (?:execucao|construcao)",
    r"contratacao (?:semi )?integrada",
    # Polish
    r"zaprojektuj i (?:wybuduj|zbuduj)",
    r"zaprojektowani(?:e|em|a) i (?:wybudowani\w*|budow\w*|przebudow\w*|rozbudow\w*"
    r"|wykonani\w* robot)",
    # Romanian: "proiectare (, verificare, asistenta tehnica) si executie lucrari".
    r"(?:proiectare|proiectarea|proiect tehnic)(?: \S+){0,10}? (?:si |de )?executi\w*(?: de)?"
    r" lucrari\w*",
    # Finnish, Hungarian, Croatian
    r"kvr urak\w*",
    r"kokonaisvastuurakentami\w*",
    r"tervezes(?:i)? es kivitelezes\w*",
    r"projektiranje i gradenje",
)
_DESIGN_AND_BUILD = re.compile(
    "|".join(f"(?<!\\S)(?:{pattern})(?!\\S)" for pattern in _DESIGN_AND_BUILD_PATTERNS)
)

# Phrases for server-side full-text search (TED expert search ``FT``). They are a recall net,
# looser than the patterns above; every hit is confirmed with ``is_design_and_build``.
DESIGN_AND_BUILD_SEARCH_PHRASES = (
    "conception réalisation",
    "marché global de performance",
    "entreprise totale",
    "appalto integrato",
    "progettazione ed esecuzione",
    "progettazione esecutiva ed esecuzione",
    "progettazione e realizzazione",
    "design and build",
    "design build",
    "design and construct",
    "design and construction",
    "bouwteam",
    "UAV-GC",
    "geïntegreerd contract",
    "ontwerp en realisatie",
    "totalentreprise",
    "totalentreprenad",
    "samspillsentreprise",
    "Totalunternehmer",
    "Generalübernehmer",
    "planen und bauen",
    "Planungs- und Bauleistungen",
    "funktionale Ausschreibung",
    "Leistungsprogramm",
    "redacción del proyecto",
    "redacción de proyecto",
    "elaboración del proyecto",
    "concepção construção",
    "conceção construção",
    "projeto e execução",
    "zaprojektuj i wybuduj",
    "zaprojektowanie i wykonanie",
    "zaprojektowanie i budowa",
    "KVR-urakka",
    "tervezés és kivitelezés",
    "tervezési és kivitelezési",
    "proiectare și execuție",
    "proiectarea și execuția",
    "proiect tehnic și execuție",
    "projektiranje i građenje",
)


def has_design_cpv(cpv_codes: Iterable[str]) -> bool:
    """A CPV code (main or additional) under ``71`` or ``7993``."""
    return any(str(code).startswith(SCOPE_CPV_PREFIXES) for code in cpv_codes)


def is_design_and_build(title: str | None, description: str | None = None) -> bool:
    """The title or the start of the description names an integrated design-and-build contract."""
    text = f"{title or ''} {(description or '')[:DESCRIPTION_CHARS]}"
    return _DESIGN_AND_BUILD.search(normalize_text(text)) is not None
