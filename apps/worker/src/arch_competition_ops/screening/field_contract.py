"""The fact names, value formats and public vocabularies shared by writer and reader."""

from dataclasses import dataclass
from typing import Literal

from arch_competition_ops.models.source import Taxonomy


@dataclass(frozen=True)
class Fact:
    kind: str
    description: str
    taxonomy: str | None = None
    paths: tuple[str, ...] = ()


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
            "In title_quote, quote the original project title exactly as stated. Use "
            "notice_title when supplied, otherwise look in notice_text. Return an empty "
            "string only if the notice states no title."
        ),
        paths=("title", "objet", "notice-title.eng", "listing.title.en"),
    ),
    "organizer": Fact("text", "Named body organizing the competition or commissioning the work."),
    "authority_name": Fact(
        "text",
        "Contracting authority or buyer as named in the notice.",
        paths=("buyer", "authority", "nomacheteur", "agency_name", "organisation-name-buyer.eng"),
    ),
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
        paths=(
            "deadline",
            "tenderDeadline",
            "submission_deadline_date",
            "datelimitereponse",
            "deadline-receipt-tender-date-lot",
            "detail.project-info.deadlines.date",
        ),
    ),
    "registration_fee_eur": Fact(
        "money", "Fee to register, including zero only when explicitly priced in euros."
    ),
    "submission_fee_eur": Fact("money", "Fee to submit an entry or tender."),
    "estimated_contract_value_eur": Fact(
        "money",
        "Estimated value of the commissioned contract, distinct from the construction budget.",
        paths=("estimatedValueEur",),
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
        "label",
        "Procurement or competition procedure stated by the buyer.",
        "procedure_types",
        paths=("procedureType", "procedure-type", "procurement_method_name"),
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
        "text",
        "Identifier assigned to the notice by the issuing authority.",
        paths=("officialNoticeId", "noticeId", "notice-identifier", "idweb", "bid_reference_no"),
    ),
}
FactName = Literal[*FIELDS]
FIELD_BY_PATH = {path: name for name, spec in FIELDS.items() for path in spec.paths}


def render_contract(taxonomy: Taxonomy, known=frozenset()) -> str:
    lines = [
        "The source title is already available. Leave title_quote empty."
        if "title" in known
        else FIELDS["title"].description,
        "Extract all supported facts for both recommend and needs_review notices.",
        (
            "Consider every field below. Include each supported fact once. For text, give its "
            "field and exact quote only. For all other kinds, give field, value and exact quote. "
            "Omit unsupported facts. Output labels classify evidence; "
            "they do not decide eligibility."
        ),
        *(f"{kind}: {rule}" for kind, rule in KIND_FORMAT.items()),
    ]
    for name, fact in FIELDS.items():
        if name == "title" or name in known:
            continue
        line = f"{name} ({fact.kind}): {fact.description}"
        if fact.taxonomy:
            labels = getattr(taxonomy, fact.taxonomy)
            line += " Allowed: " + ", ".join(labels) if labels else " No labels available; omit."
        lines.append(line)
    return "\n".join(lines)
