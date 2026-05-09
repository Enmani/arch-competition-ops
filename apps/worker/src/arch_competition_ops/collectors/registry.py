from __future__ import annotations

from collections.abc import Callable

from arch_competition_ops.collectors.anac import collect_anac_documents
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.boamp import collect_boamp_documents
from arch_competition_ops.collectors.canadabuys import collect_canadabuys_documents
from arch_competition_ops.collectors.competitions_archi import collect_competitions_archi_documents
from arch_competition_ops.collectors.contracts_finder import collect_contracts_finder_documents
from arch_competition_ops.collectors.doffin import collect_doffin_documents
from arch_competition_ops.collectors.generic_rss import collect_generic_rss_documents
from arch_competition_ops.collectors.ggzy import collect_ggzy_documents
from arch_competition_ops.collectors.municipal import collect_municipal_buyer_profile_documents
from arch_competition_ops.collectors.pcsp import collect_pcsp_documents
from arch_competition_ops.collectors.scaffold import collect_scaffold_only_documents
from arch_competition_ops.collectors.scp import collect_scp_documents
from arch_competition_ops.collectors.simap import collect_simap_documents
from arch_competition_ops.collectors.ted import collect_ted_documents
from arch_competition_ops.collectors.tenderned import collect_tenderned_documents
from arch_competition_ops.models import SourceDefinition


Collector = Callable[..., list[CollectedSourceDocument]]

# AI maintenance note:
# - Keep one reusable collector family per upstream shape.
# - New country packs should prefer `collector: <family>` in YAML before adding another source-id-specific registration.
COLLECTORS: dict[str, Collector] = {
    "ted_design_notices": collect_ted_documents,
    "boamp_design_notices": collect_boamp_documents,
    "simap_public_design_notices": collect_simap_documents,
    "anac_bdncp_contracts": collect_anac_documents,
    "serviziocontrattipubblici_hub": collect_scp_documents,
    "municipal_buyer_profiles": collect_municipal_buyer_profile_documents,
    "competitions_archi": collect_competitions_archi_documents,
    "generic_rss_feed": collect_generic_rss_documents,
    "canadabuys_csv": collect_canadabuys_documents,
    "contracts_finder_ocds": collect_contracts_finder_documents,
    "doffin_search_api": collect_doffin_documents,
    "ggzy_public_notices": collect_ggzy_documents,
    "pcsp_atom_feed": collect_pcsp_documents,
    "disabled_scaffold": collect_scaffold_only_documents,
    "tenderned_publications_api": collect_tenderned_documents,
}


def collect_source_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
) -> list[CollectedSourceDocument]:
    collector = COLLECTORS.get(source.source_id)
    if collector is None and source.collector:
        collector = COLLECTORS.get(source.collector)
    if collector is None:
        if source.collector:
            raise ValueError(
                f"No collector registered for source id '{source.source_id}' or collector family "
                f"'{source.collector}'"
            )
        raise ValueError(f"No collector registered for source id: {source.source_id}")
    return collector(source, limit=limit, publication_date_from=publication_date_from)
