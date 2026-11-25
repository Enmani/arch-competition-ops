"""Distinguish source text from empty data structures and site navigation before billing."""

import json
import re
from urllib.parse import urlsplit

from arch_competition_ops.screening.notice_urls import URL, PageLinks


class NoReadableText(ValueError):
    def __init__(self, url):
        self.url_class = url_class(url)
        super().__init__("no_readable_text")


def url_class(url):
    parts = urlsplit(url)
    return (
        "site_root"
        if parts.path in {"", "/"} and not (parts.query or parts.fragment)
        else "notice_url"
    )


class VisibleNotice(PageLinks):
    """Collect text and links from the same visible portion of the document."""

    def __init__(self, url, *, content_only=False):
        super().__init__(url)
        self.content_only = content_only
        self.text = []
        self.skipped = []
        self.content_depth = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            return
        if self.skipped:
            self.skipped.append(tag)
            return
        if (
            tag in {"head", "script", "style", "nav", "template"}
            or (self.content_only and not self.content_depth and tag in {"header", "aside"})
            or (
                self.content_only
                and not self.content_depth
                and tag == "a"
                and url_class(self.base_url) == "site_root"
            )
            or (tag == "footer" and not self.content_depth)
            or "hidden" in attributes
            or attributes.get("aria-hidden") == "true"
            or attributes.get("role") == "navigation"
        ):
            self.skipped.append(tag)
            return
        if tag in {"article", "main"}:
            self.content_depth += 1
        super().handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if self.skipped:
            if tag in self.skipped:
                while self.skipped.pop() != tag:
                    pass
        elif tag in {"article", "main"}:
            self.content_depth = max(0, self.content_depth - 1)

    def handle_data(self, data):
        if not self.skipped:
            self.text.append(data)


def has_notice_text(material, url):
    """Ignore JSON keys, identifiers and links. Any remaining human text suffices."""

    boamp_index = url_class(url) == "site_root" and urlsplit(url).hostname in {
        "boamp.fr",
        "www.boamp.fr",
    }

    def readable(value, *, page_text=False):
        if isinstance(value, dict):
            return any(
                readable(v)
                for k, v in value.items()
                if not re.search(r"^id(?:$|[A-Z_])|(?:Id|ID|_id)$", k)
            )
        if isinstance(value, list):
            return any(readable(v) for v in value)
        if not isinstance(value, str) or not (value := value.strip()):
            return False
        if value.startswith(("{", "[")):
            try:
                data, end = json.JSONDecoder().raw_decode(value)
            except ValueError:
                pass
            else:
                return readable(data) or readable(value[end:], page_text=page_text)
        # Historic BOAMP URLs can point at its index. Even flattened page text there belongs
        # to the index; structured listing fields can still identify a real notice.
        if page_text and boamp_index:
            return False
        if "<" in value:
            page = VisibleNotice(url, content_only=True)
            page.feed(value)
            page.close()
            value = " ".join(page.text)
        if not page_text and re.fullmatch(r"(?=.*[0-9])[A-Z0-9_.-]+", value):
            return False
        if not page_text and re.fullmatch(r"\d{4}-\d\d-\d\d(?:[T ][\d:.+Z-]+)?", value):
            return False
        return any(c.isalpha() for c in URL.sub("", value))

    return readable(material, page_text=True)
