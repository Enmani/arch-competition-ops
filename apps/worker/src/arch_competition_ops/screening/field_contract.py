"""The fact names, value formats and public vocabularies shared by writer and reader."""

from dataclasses import dataclass
from typing import Literal

from arch_competition_ops.models.source import Taxonomy


@dataclass(frozen=True)
class Fact:
    kind: str
    description: str
    taxonomy: str | None = None


KIND_FORMAT = {
    "text": "Return only the exact passage that is the field value, in its original language. "
    "Do not translate titles; display translations are generated separately.",
    "url": "Copy one exact public URL supplied in notice_links.",
    "date": (
        "Use the buyer's local calendar date as YYYY-MM-DD; cite the date with its "
        "deadline context."
    ),
    "money": (
        "Supply a plain non-negative decimal with no grouping or currency symbol. The "
        "quote must explicitly give that amount in EUR or euros (€)."
    ),
    "bool": (
        'Use the string "true" or "false" only when the notice explicitly establishes '
        "the requirement or exemption."
    ),
    "label": "Select one exact allowed label supported by the quote.",
    "label-list": (
        "Encode the applicable allowed labels as a JSON array inside the value string, "
        'e.g. ["architecture"].'
    ),
}

FIELDS = {
    "title": Fact(
        "text",
        (
            "Required whenever a title is stated. Copy and quote the full notice_title when "
            "available. Otherwise find and quote the original project title in notice_text."
        ),
    ),
    "organizer": Fact("text", "Named body organizing the competition or commissioning the work."),
    "authority_name": Fact("text", "Contracting authority or buyer as named in the notice."),
    "official_url": Fact("url", "Public notice or project page for this specific commission."),
    "location_label": Fact(
        "text", "Project site or address as written, excluding the buyer's office."
    ),
    "location_city": Fact("text", "City or municipality of the project site."),
    "location_region": Fact("text", "Region, province or state of the project site."),
    "deadline_at": Fact(
        "date",
        (
            "Deadline for submitting the tender, entry or application. Put other milestones "
            "in timeline excerpts."
        ),
    ),
    "registration_fee_eur": Fact(
        "money", "Fee to register, including zero only when explicitly priced in euros."
    ),
    "submission_fee_eur": Fact("money", "Fee to submit an entry or tender."),
    "estimated_contract_value_eur": Fact(
        "money",
        "Estimated value of the commissioned contract, distinct from the construction budget.",
    ),
    "estimated_contract_value_text": Fact(
        "text", "Original wording for the contract value, retaining currency and qualifications."
    ),
    "prize_summary": Fact("text", "Original wording for prizes or awards."),
    "eligibility_summary": Fact("text", "A short verbatim clause stating who may participate."),
    "brief_pdf_url": Fact("url", "Public link to the project brief PDF."),
    "documents_portal_url": Fact(
        "url", "Portal supplying this project's tender or competition documents."
    ),
    "opportunity_type": Fact(
        "label", "Kind of design commission being offered.", "opportunity_types"
    ),
    "procedure_type": Fact(
        "label", "Procurement or competition procedure stated by the buyer.", "procedure_types"
    ),
    "implementation_path": Fact(
        "label",
        "How selection leads to a commission or follow-on contract.",
        "implementation_paths",
    ),
    "licensed_architect_required": Fact(
        "bool", "Whether professional architect registration is explicitly required."
    ),
    "local_partner_required": Fact("bool", "Whether a local partner is explicitly required."),
    "competition_types": Fact(
        "label-list", "Architectural disciplines or competition themes.", "competition_types"
    ),
    "project_types": Fact("label-list", "Nature of the design project.", "project_types"),
    "building_categories": Fact(
        "label-list", "Functions of the buildings involved.", "building_categories"
    ),
    "design_scopes": Fact(
        "label-list", "Design services and phases included in the commission.", "design_scopes"
    ),
    "project_modes": Fact(
        "label-list",
        "Whether the physical works are new build, renovation or extension.",
        "project_modes",
    ),
    "audience": Fact(
        "label-list", "Eligible participant groups described by the notice.", "audience"
    ),
    "jurisdiction": Fact("label", "Project jurisdiction supported by the notice.", "regions"),
    "languages": Fact(
        "label-list", "Languages explicitly specified for participation or submission.", "languages"
    ),
    "official_notice_id": Fact(
        "text", "Identifier assigned to the notice by the issuing authority."
    ),
}
FactName = Literal[*FIELDS]


def render_contract(taxonomy: Taxonomy) -> str:
    lines = [
        "Extracted facts",
        (
            "Consider every field below. Include each supported fact once. For text, give its "
            "field and exact quote only. For all other kinds, give field, value and exact quote. "
            "Omit unsupported facts. Output labels classify evidence; "
            "they do not decide eligibility."
        ),
        *(f"{kind}: {rule}" for kind, rule in KIND_FORMAT.items()),
    ]
    for name, fact in FIELDS.items():
        line = f"{name} ({fact.kind}): {fact.description}"
        if fact.taxonomy:
            labels = getattr(taxonomy, fact.taxonomy)
            line += " Allowed: " + ", ".join(labels) if labels else " No labels available; omit."
        lines.append(line)
    return "\n".join(lines)
