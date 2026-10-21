# System Context

This repository is for professional architecture opportunity intelligence.

## Always Read

- `config/sources.yml`
- `config/filters.yml`
- `config/taxonomy.yml`
- `AGENTS.md`

## Global Rules

1. Preserve provenance.
2. Prefer official procurement and authority sources when conflicts appear.
3. Normalize into the canonical schema before summarizing.
4. Keep uncertainty explicit.
5. Do not treat aggregator or media text as final authority.
6. Downrank speculative or student-only calls when the user target is licensed practice work.

## Canonical Fields

- title
- authority_name
- organizer
- source_id
- source_name
- official_url
- source_url
- official_notice_id
- jurisdiction
- opportunity_type
- procedure_type
- cpv_codes
- implementation_path
- licensed_architect_required
- local_partner_required
- deadline_at
- registration_fee_eur
- submission_fee_eur
- estimated_contract_value_eur
- prize_summary
- eligibility_summary
- competition_types
- audience
- regions
- languages
- brief_pdf_url
- evidence_level
- qualification_score
- evidence_note

## Field Semantics

- `organizer` is the real buyer or organizer named in the notice. Unknown is the empty string. The publishing platform goes to `source_id` / `source_name`, never to `organizer`.
- `registration_fee_eur` / `submission_fee_eur` are `null` unless the source explicitly states a fee; `0` only when it explicitly states the call is free.
- `official_url` is written only when the notice links to an official page; do not copy `source_url` into it.
- `eligibility_summary` holds only the notice's own qualification clause, verbatim; project descriptions never go there. Empty when the source has no such clause.
- `audience`, `implementation_path`, `licensed_architect_required`, and `local_partner_required` stay empty unless the notice states them (the last two only from a qualification clause).
- `extraction_confidence` is computed from how many evidence fields were found, not assigned by hand.
