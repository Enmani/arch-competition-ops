from arch_competition_ops.screening.models import ScreeningDecision, validate_evidence


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
