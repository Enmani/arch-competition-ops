from __future__ import annotations

import inspect
from collections.abc import Callable
from pathlib import Path

from arch_competition_ops.collectors.adgpg import collect_adgpg_documents
from arch_competition_ops.collectors.anac import collect_anac_documents
from arch_competition_ops.collectors.ashghal import collect_ashghal_documents
from arch_competition_ops.collectors.bahrain_tender_board import (
    collect_bahrain_tender_board_documents,
)
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.boamp import collect_boamp_documents
from arch_competition_ops.collectors.canadabuys import collect_canadabuys_documents
from arch_competition_ops.collectors.competitions_archi import collect_competitions_archi_documents
from arch_competition_ops.collectors.contracts_finder import collect_contracts_finder_documents
from arch_competition_ops.collectors.doffin import collect_doffin_documents
from arch_competition_ops.collectors.etimad import collect_etimad_documents
from arch_competition_ops.collectors.find_a_tender import collect_find_a_tender_documents
from arch_competition_ops.collectors.generic_pages import collect_generic_notice_pages
from arch_competition_ops.collectors.generic_rss import collect_generic_rss_documents
from arch_competition_ops.collectors.ggzy import collect_ggzy_documents
from arch_competition_ops.collectors.isdb import collect_isdb_documents
from arch_competition_ops.collectors.joneps import collect_joneps_documents
from arch_competition_ops.collectors.monaqasat import collect_monaqasat_documents
from arch_competition_ops.collectors.municipal import collect_municipal_buyer_profile_documents
from arch_competition_ops.collectors.oeffentlichevergabe import (
    collect_oeffentlichevergabe_documents,
)
from arch_competition_ops.collectors.pcsp import collect_pcsp_documents
from arch_competition_ops.collectors.scaffold import collect_scaffold_only_documents
from arch_competition_ops.collectors.scp import collect_scp_documents
from arch_competition_ops.collectors.simap import collect_simap_documents
from arch_competition_ops.collectors.ted import collect_ted_documents
from arch_competition_ops.collectors.tenderned import collect_tenderned_documents
from arch_competition_ops.collectors.uae_mof import collect_uae_mof_documents
from arch_competition_ops.collectors.ungm import collect_ungm_documents
from arch_competition_ops.collectors.world_bank import collect_world_bank_documents
from arch_competition_ops.models import SourceDefinition

Collector = Callable[..., list[CollectedSourceDocument]]

# AI maintenance note:
# - Keys are collector *families* (one per upstream shape). A source selects its family with the
#   required `collector:` field in YAML; there is no lookup by source_id.
# - New country packs should reuse a family before adding another one.
COLLECTORS: dict[str, Collector] = {
    "ted_search_api": collect_ted_documents,
    "boamp_opendatasoft": collect_boamp_documents,
    "simap_project_api": collect_simap_documents,
    "anac_legal_publicity_api": collect_anac_documents,
    "scp_open_data_csv": collect_scp_documents,
    "municipal_buyer_profiles": collect_municipal_buyer_profile_documents,
    "competitions_archi_feed": collect_competitions_archi_documents,
    "generic_rss_feed": collect_generic_rss_documents,
    "generic_notice_pages": collect_generic_notice_pages,
    "canadabuys_csv": collect_canadabuys_documents,
    "contracts_finder_ocds": collect_contracts_finder_documents,
    "find_a_tender_ocds": collect_find_a_tender_documents,
    "doffin_search_api": collect_doffin_documents,
    "ggzy_public_notices": collect_ggzy_documents,
    "pcsp_atom_feed": collect_pcsp_documents,
    "oeffentlichevergabe_ocds": collect_oeffentlichevergabe_documents,
    "disabled_scaffold": collect_scaffold_only_documents,
    "tenderned_publications_api": collect_tenderned_documents,
    "world_bank_procnotices": collect_world_bank_documents,
    "ungm_notice_search": collect_ungm_documents,
    "isdb_tender_list": collect_isdb_documents,
    "adgpg_public_tenders": collect_adgpg_documents,
    "mof_dpp_ajax_list": collect_uae_mof_documents,
    "etimad_visitor_tenders": collect_etimad_documents,
    "monaqasat_available_tenders": collect_monaqasat_documents,
    "ashghal_open_tenders": collect_ashghal_documents,
    "bahrain_tender_board_published": collect_bahrain_tender_board_documents,
    "joneps_tender_invitations": collect_joneps_documents,
}


class UnknownCollectorError(ValueError):
    """A source names a collector family that is not registered."""


def collect_source_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    archive_dir: Path | None = None,
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    """Run the collector family declared by ``source.collector``.

    ``archive_dir`` is passed only to families that keep raw responses as evidence (they declare
    an ``archive_dir`` keyword); the others never see it.
    """
    collector = COLLECTORS.get(source.collector)
    if collector is None:
        raise UnknownCollectorError(
            f"Source '{source.source_id}' uses collector family '{source.collector}', which is "
            f"not registered. Known families: {', '.join(sorted(COLLECTORS))}"
        )

    options: dict[str, object] = {
        "limit": limit,
        "publication_date_from": publication_date_from,
    }
    if archive_dir is not None and "archive_dir" in inspect.signature(collector).parameters:
        options["archive_dir"] = archive_dir
    if "include_unclassified" in inspect.signature(collector).parameters:
        options["include_unclassified"] = include_unclassified
    return collector(source, **options)
