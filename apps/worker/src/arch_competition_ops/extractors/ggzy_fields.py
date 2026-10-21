"""Field extraction from GGZY (China public-resources) notice text.

Operates on already-extracted plain text (see ``collectors.ggzy.html_text``) and returns raw
field values; no network, no HTML. The collector assembles these into the payload that the
generic listing parser turns into a record.

Deadline policy: a date is only a deadline when the text labels it as one (投标/响应/提交/递交截止,
报名截止, or the "于 <date>（北京时间）前提交" phrase). Opening times (开标/开启时间), publication
or page-generation dates, and unlabeled dates are never used, and an unlabeled notice yields
``None`` rather than a guess.
"""

from __future__ import annotations

import re
from datetime import date

from arch_competition_ops.normalizers.dates import parse_date

AUTHORITY_PATTERNS = (
    r"(?:招标人[（(]项目业主[)）]?为)\s*([^\s，。,；;]+(?:公司|局|院|中心|政府|委员会|管理处|管理局))",
    r"(?:采购人信息.*?名称[:：]\s*)(.+?)(?=(?:地址|联系方式|联系人|采购代理机构信息|$))",
    r"(?:招标人[:：]\s*)(.+?)(?=(?:招标代理机构|联系人|电话|$))",
    r"(?:采购人|采购单位|招标人|招标单位|建设单位|业主单位|项目业主|采购代理机构)[:：]\s*(.+?)(?=(?:项目编号|招标编号|采购编号|项目名称|投标文件|响应文件|招标控制价|预算金额|最高限价|采购需求|项目概况|$))",
)
NOTICE_ID_PATTERNS = (
    r"(?:项目编号|招标编号|采购编号|项目招标编号|交易编号|项目编码)[:：]\s*([A-Za-z0-9一-鿿\-\(\)]+)",
)
PROCEDURE_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"(?:采购方式|招标方式)[:：]\s*公开招标", "open"),
    (r"(?:采购方式|招标方式)[:：]\s*竞争性磋商", "public_design_services_tender"),
    (r"(?:采购方式|招标方式)[:：]\s*竞争性谈判", "negotiated_procedure"),
    (r"(?:采购方式|招标方式)[:：]\s*单一来源", "negotiated_procedure"),
    (r"(?:采购方式|招标方式)[:：]\s*询价", "public_design_services_tender"),
)
VALUE_PATTERNS = (
    r"(?:预算金额|最高限价|招标控制价|控制价|项目估算总投资|项目估算投资|投资估算)[:：]\s*([0-9][0-9,.\s]*)\s*元",
)

# Labels that mean "the last moment to submit or register", with a priority (higher wins).
# 开标时间 / 开启时间 (opening time) are intentionally absent: an opening date is not a deadline.
DEADLINE_LABELS: tuple[tuple[str, int], ...] = (
    ("投标文件递交的截止时间为", 12),
    ("投标文件递交截止时间为", 12),
    ("投标文件递交截止时间", 12),
    ("响应文件提交截止时间", 12),
    ("提交响应文件截止时间", 12),
    ("投标文件截止时间", 11),
    ("投标截止时间", 11),
    ("投标截止日期", 11),
    ("响应文件截止时间", 11),
    ("响应文件递交截止时间", 11),
    ("递交投标文件截止时间", 11),
    ("提交投标文件截止时间", 11),
    ("递交截止时间", 10),
    ("提交截止时间", 10),
    ("申请文件递交截止时间", 10),
    ("报名截止时间", 9),
    ("报名截止日期", 9),
    ("截止时间", 8),
)
SUBMIT_BEFORE_PRIORITY = 10
# A bare "截止时间" preceded by one of these is some other process deadline (Q&A, document
# sale, site visit ...), not the submission deadline.
NON_SUBMISSION_PREFIXES = (
    "答疑",
    "澄清",
    "质疑",
    "异议",
    "发售",
    "获取",
    "购买",
    "出售",
    "公示",
    "踏勘",
)
REASONABLE_DEADLINE_WINDOW_DAYS = 365

_ZH_DATE = (
    r"(?:\d\s*){4}年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}\s*[时点:：]\s*\d{1,2}(?:\s*分)?)?"
)
_ISO_DATE = r"\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?"
_LABEL_ALTERNATION = "|".join(
    re.escape(label) for label, _ in sorted(DEADLINE_LABELS, key=lambda item: -len(item[0]))
)
_LABEL_PRIORITY = dict(DEADLINE_LABELS)
# label, at most 16 non-digit characters (punctuation, "为", "：" ...), then the date. The
# digit-free gap stops a label from reaching across a line to some other date.
_LABELED_DATE = re.compile(rf"({_LABEL_ALTERNATION})[^0-9]{{0,16}}({_ZH_DATE}|{_ISO_DATE})")
_SUBMIT_BEFORE_DATE = re.compile(
    rf"于\s*({_ZH_DATE})\s*[（(]北京时间[)）]?\s*前\s*(?:提交|递交|送达)"
)

# Clause headings that introduce a qualification/eligibility requirement.
QUALIFICATION_HEADINGS = (
    "投标人资格要求",
    "投标人的资格要求",
    "申请人的资格要求",
    "申请人资格要求",
    "供应商的资格要求",
    "供应商资格要求",
    "资格要求",
    "资质要求",
    "资格条件",
    "资质条件",
)
_QUALIFICATION_END_MARKERS = (
    "获取招标文件",
    "获取采购文件",
    "获取文件",
    "投标文件的递交",
    "投标文件递交",
    "响应文件提交",
    "响应文件开启",
    "开标时间",
    "联系方式",
    "采购人信息",
    "招标代理机构",
    "投标保证金",
    "评标办法",
    "公告期限",
)
MAX_QUALIFICATION_CLAUSE_CHARS = 600


def normalize_space(value: str | None) -> str | None:
    if not value:
        return None
    collapsed = re.sub(r"\s+", " ", value)
    return collapsed.strip() or None


def _sanitize_extracted_value(value: str | None) -> str | None:
    candidate = normalize_space(value)
    if not candidate:
        return None
    candidate = re.split(
        r"\s+(?=(?:"
        r"项目编号|招标编号|采购编号|项目招标编号|交易编号|项目编码|"
        r"项目名称|投标文件|响应文件|招标控制价|预算金额|最高限价|"
        r"采购需求|项目概况|项目内容|简要规格描述|合同履约期限|"
        r"联系人|联系方式|电话|地址|采购方式|招标方式|"
        r"招标代理机构|采购代理机构信息|采购代理机构"
        r")[:：])",
        candidate,
        maxsplit=1,
    )[0]
    return candidate.strip(" ，,；;。")


def extract_first(patterns: tuple[str, ...], text: str) -> str | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        for pattern in patterns:
            match = re.search(pattern, line, flags=re.IGNORECASE)
            if match:
                candidate = _sanitize_extracted_value(match.group(1))
                if candidate:
                    return candidate

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            candidate = _sanitize_extracted_value(match.group(1))
            if candidate:
                return candidate
    return None


def extract_procedure_type(
    text: str, business_type_text: str | None, information_type_text: str | None
) -> str | None:
    for pattern, normalized_value in PROCEDURE_PATTERNS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return normalized_value

    business_type = (business_type_text or "").strip()
    information_type = (information_type_text or "").strip()
    if business_type == "政府采购":
        return "public_design_services_tender"
    if "招标" in information_type:
        return "open"
    return None


def extract_value_text(text: str) -> str | None:
    for pattern in VALUE_PATTERNS:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            amount = re.sub(r"\s+", "", match.group(1))
            return f"CNY {amount}"
    return None


def extract_qualification_clause(text: str) -> str | None:
    """The notice's own qualification section, or ``None`` when it has no such heading.

    Returns only text that follows a qualification heading (up to the next section marker or
    ``MAX_QUALIFICATION_CLAUSE_CHARS``). The page body is never a substitute: licence and
    local-partner requirements may only be inferred from a clause the notice actually states.
    """
    positions = [
        (text.find(heading), heading) for heading in QUALIFICATION_HEADINGS if heading in text
    ]
    if not positions:
        return None
    start, heading = min(positions, key=lambda item: item[0])
    clause_start = start + len(heading)
    window = text[clause_start : clause_start + MAX_QUALIFICATION_CLAUSE_CHARS]
    end_positions = [
        window.find(marker) for marker in _QUALIFICATION_END_MARKERS if marker in window
    ]
    if end_positions:
        window = window[: min(end_positions)]
    return normalize_space(window.lstrip(" :：")) or None


# -- deadline -----------------------------------------------------------------------------------


def _has_non_submission_prefix(text: str, label_start: int) -> bool:
    preceding = text[max(0, label_start - 8) : label_start]
    return any(prefix in preceding for prefix in NON_SUBMISSION_PREFIXES)


def _deadline_candidates(text: str) -> list[tuple[int, date]]:
    """``(priority, date)`` for every labelled deadline in ``text``; priority is always > 0."""
    candidates: list[tuple[int, date]] = []

    for match in _LABELED_DATE.finditer(text):
        label, raw_date = match.group(1), match.group(2)
        priority = _LABEL_PRIORITY[label]
        if label == "截止时间" and _has_non_submission_prefix(text, match.start(1)):
            continue
        parsed = parse_date(raw_date)
        if parsed is not None:
            candidates.append((priority, parsed))

    for match in _SUBMIT_BEFORE_DATE.finditer(text):
        parsed = parse_date(match.group(1))
        if parsed is not None:
            candidates.append((SUBMIT_BEFORE_PRIORITY, parsed))

    return candidates


def _is_reasonable_deadline(deadline: date, *, published_at: date | None) -> bool:
    if published_at is None:
        return True
    return -7 <= (deadline - published_at).days <= REASONABLE_DEADLINE_WINDOW_DAYS


def extract_deadline_iso(text: str, *, published_at_iso: str | None = None) -> str | None:
    """Best labelled submission/registration deadline as ISO date, or ``None``.

    The highest-priority label wins; ties go to the later date (an extended deadline supersedes
    the original). Candidates more than 7 days before, or more than a year after, the listing's
    publication date are discarded as misparsed.
    """
    try:
        published_at = date.fromisoformat(published_at_iso) if published_at_iso else None
    except ValueError:
        published_at = None

    reasonable = [
        (priority, deadline)
        for priority, deadline in _deadline_candidates(text)
        if _is_reasonable_deadline(deadline, published_at=published_at)
    ]
    if not reasonable:
        return None
    return max(reasonable)[1].isoformat()
