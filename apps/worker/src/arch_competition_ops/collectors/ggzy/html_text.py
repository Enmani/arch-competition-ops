"""Plain-text extraction from GGZY detail pages (Word-export HTML included)."""

from __future__ import annotations

import re
from html import unescape
from html.parser import HTMLParser

from arch_competition_ops.normalizers.text import strip_html


def normalize_space(value: str | None) -> str | None:
    if not value:
        return None
    collapsed = re.sub(r"\s+", " ", unescape(value))
    return collapsed.strip() or None


def strip_html_block(value: str | None) -> str | None:
    return normalize_space(strip_html(value))


class _GGZYDetailContentTextParser(HTMLParser):
    _BLOCK_TAGS = {
        "article",
        "blockquote",
        "br",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "p",
        "section",
        "table",
        "td",
        "th",
        "tr",
    }
    _IGNORED_TAGS = {"head", "link", "meta", "noscript", "script", "style", "title"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._capture_depth = 0
        self._ignored_depth = 0
        self._parts: list[str] = []

    @staticmethod
    def _has_detail_content_class(attrs: list[tuple[str, str | None]]) -> bool:
        for name, value in attrs:
            if name.lower() != "class" or not value:
                continue
            if "detail_content" in re.split(r"\s+", value):
                return True
        return False

    @classmethod
    def _is_ignored_tag(cls, tag: str) -> bool:
        normalized_tag = tag.lower()
        return (
            normalized_tag in cls._IGNORED_TAGS or normalized_tag == "xml" or ":" in normalized_tag
        )

    def _push_break(self) -> None:
        if not self._parts:
            return
        if self._parts[-1] == " ":
            self._parts.pop()
        if self._parts and self._parts[-1] != "\n":
            self._parts.append("\n")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized_tag = tag.lower()
        if self._capture_depth == 0:
            if not self._has_detail_content_class(attrs):
                return
            self._capture_depth = 1
        else:
            self._capture_depth += 1

        if self._is_ignored_tag(normalized_tag):
            self._ignored_depth += 1
            return
        if normalized_tag in self._BLOCK_TAGS:
            self._push_break()

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if self._capture_depth == 0:
            return

        normalized_tag = tag.lower()
        if self._ignored_depth == 0 and normalized_tag in self._BLOCK_TAGS:
            self._push_break()
        if self._is_ignored_tag(normalized_tag) and self._ignored_depth > 0:
            self._ignored_depth -= 1

        self._capture_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._capture_depth == 0 or self._ignored_depth > 0:
            return
        text = re.sub(r"\s+", " ", unescape(data)).strip()
        if not text:
            return
        if self._parts and self._parts[-1] not in {" ", "\n"}:
            self._parts.append(" ")
        self._parts.append(text)

    def get_text(self) -> str | None:
        if not self._parts:
            return None
        text = "".join(self._parts)
        text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
        text = re.sub(r"\n{2,}", "\n", text)
        return text.strip() or None


def _extract_notice_body_html(detail_html: str) -> str | None:
    mycontent_match = re.search(r'<div[^>]+id="mycontent"[^>]*>', detail_html, flags=re.IGNORECASE)
    if mycontent_match:
        detail_match = re.search(
            r'<div[^>]+class="[^"]*\bdetail_content\b[^"]*"[^>]*>',
            detail_html[mycontent_match.end() :],
            flags=re.IGNORECASE,
        )
        if detail_match:
            start = mycontent_match.end() + detail_match.end()
            depth = 1
            idx = start
            tag_pattern = re.compile(r"</?div\b[^>]*>", flags=re.IGNORECASE)
            for tag_match in tag_pattern.finditer(detail_html, start):
                tag_text = tag_match.group(0)
                if tag_text.startswith("</") or tag_text.startswith("</".upper()):
                    depth -= 1
                    if depth == 0:
                        return detail_html[start : tag_match.start()]
                else:
                    depth += 1
                idx = tag_match.end()
            if idx > start:
                return detail_html[start:idx]

    match = re.search(
        r'<div id="mycontent">\s*<div class="detail_content">(.*)</div>\s*'
        r"</div>\s*</div>\s*</body>",
        detail_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if match:
        return match.group(1)
    match = re.search(
        r'<div class="detail_content">(.*)</div>\s*</div>\s*</body>',
        detail_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if match:
        return match.group(1)
    return None


def extract_notice_body_text(detail_html: str) -> str | None:
    if not detail_html:
        return None

    parser = _GGZYDetailContentTextParser()
    try:
        parser.feed(detail_html)
        parser.close()
    except Exception:  # noqa: BLE001
        parser = _GGZYDetailContentTextParser()

    body_text = parser.get_text()
    if body_text:
        return body_text

    body_html = _extract_notice_body_html(detail_html)
    if body_html:
        return strip_html_block(body_html)
    return None


def extract_original_link(detail_html: str) -> str | None:
    match = re.search(
        r'<a[^>]+href="([^"]+)"[^>]*>\s*原文链接地址\s*</a>',
        detail_html,
        flags=re.IGNORECASE,
    )
    return normalize_space(match.group(1)) if match else None


def extract_detail_title(detail_html: str) -> str | None:
    match = re.search(
        r'<h4[^>]*class="h4_o"[^>]*>(.*?)</h4>', detail_html, flags=re.IGNORECASE | re.DOTALL
    )
    return strip_html_block(match.group(1)) if match else None


def extract_original_category_text(original_html: str) -> str | None:
    bread_match = re.search(
        r'<div[^>]+class="[^"]*\bewb-bread\b[^"]*"[^>]*>(.*?)</div>',
        original_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not bread_match:
        return None
    return strip_html_block(bread_match.group(1))
