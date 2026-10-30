from arch_competition_ops.screening.models import ScreeningDecision, validate_evidence


def test_program_labels_are_not_notice_evidence_but_original_categories_and_text_survive():
    import json

    from arch_competition_ops.screening.source_evidence import notice_evidence

    payload = {
        "title": "Refrigeration Training Equipment",
        "summary": "Industrial refrigerators",
        "opportunityType": "public_design_services_procurement",
        "projectTypes": ["building_project"],
        "category": "Goods",
        "rawNoticeHtml": "<p>Supply only.</p>",
    }
    raw = json.dumps(payload) + "\nSource notice detail:\n<p>Original detail</p>"
    cleaned = notice_evidence(raw)
    value, _ = json.JSONDecoder().raw_decode(cleaned)
    assert "opportunityType" not in value and "projectTypes" not in value
    assert value["category"] == "Goods"
    assert value["summary"] == "Industrial refrigerators"
    assert cleaned.endswith("<p>Original detail</p>")


def test_concurrent_source_reservations_share_one_budget(tmp_path):
    from concurrent.futures import ThreadPoolExecutor

    from arch_competition_ops.storage.schema import ensure_schema
    from arch_competition_ops.storage.screening import ScreeningBudgetExceeded, reserve_screening

    db = tmp_path / "ledger.sqlite"
    ensure_schema(db)

    def reserve(index):
        try:
            reserve_screening(
                db,
                competition_id=None,
                source_url=f"https://example.org/{index}",
                model="luna",
                input_json="{}",
                reserve_usd=0.6,
                budget_usd=31,
                daily_budget_usd=1,
            )
            return True
        except ScreeningBudgetExceeded:
            return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(reserve, [0, 1])) == [False, True]


def test_participation_excerpts_preserve_source_clauses_and_reject_invention():
    source = "报名：11月3日。保证金人民币2万元。联合体可以参加。"
    decision = ScreeningDecision(
        decision="recommend",
        relevance_score=80,
        summary_zh="项目",
        summary_en="Project",
        reasons_zh=[],
        reasons_en=[],
        missing_information=[],
        extracted_fields=[],
        evidence=[{"field": "notice_text", "quote": source}],
        notice_details=[
            {
                "category": "timeline",
                "text": "报名：11月3日。",
                "quote": source,
                "evidence_field": "notice_text",
            },
            {
                "category": "commercial",
                "text": "保证金人民币2万元。",
                "quote": source,
                "evidence_field": "notice_text",
            },
            {
                "category": "eligibility",
                "text": "联合体不可以参加。",
                "quote": source,
                "evidence_field": "notice_text",
            },
            {
                "category": "scope",
                "text": "Guess",
                "quote": "Guess",
                "evidence_field": "preferences",
            },
        ],
    )
    warnings = validate_evidence(decision, {"notice_text": source, "preferences": "Guess"})
    assert [d.text for d in decision.notice_details] == ["报名：11月3日。", "保证金人民币2万元。"]
    assert len(warnings) == 2
    assert decision.decision == "needs_review"
