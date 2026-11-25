"""Select original notice material from a collector envelope."""

import json


def notice_title(payload: str) -> str:
    text = payload.lstrip()
    if not text.startswith("{"):
        return ""
    try:
        envelope, _ = json.JSONDecoder().raw_decode(text)
    except ValueError:
        return ""
    raw = envelope.get("rawNotice")
    for source in (envelope, raw):
        if (
            isinstance(source, dict)
            and isinstance(title := source.get("title"), str)
            and title.strip()
        ):
            return title.strip()
    return ""


def notice_evidence(payload: str) -> str:
    stripped = payload.lstrip()
    if not stripped.startswith("{"):
        return payload
    try:
        notice, end = json.JSONDecoder().raw_decode(stripped)
    except ValueError:
        return ""
    parts = []
    for key in ("rawNotice", "rawNoticeHtml"):
        value = notice.get(key)
        if isinstance(value, str):
            parts.append(value)
        elif key == "rawNotice" and isinstance(value, dict | list):
            parts.append(json.dumps(value, ensure_ascii=False))
    if not parts:
        parts.append(
            json.dumps(
                {
                    key: notice[key]
                    for key in ("title", "category")
                    if isinstance(notice.get(key), str)
                },
                ensure_ascii=False,
            )
        )
    tail = stripped[end:].lstrip("\n")
    detail = tail.removeprefix("Source notice detail:\n")
    if detail != tail:
        parts.append(detail)
    return "\n".join(parts).replace(r"\/", "/")
