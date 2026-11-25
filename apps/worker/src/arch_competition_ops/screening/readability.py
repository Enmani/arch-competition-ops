"""Distinguish source text from empty data structures and site navigation before billing."""

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


def has_notice_text(text, url):
    """Decide on the rendered values without changing the material the model will read."""
    boamp_index = url_class(url) == "site_root" and urlsplit(url).hostname in {
        "boamp.fr",
        "www.boamp.fr",
    }
    host = urlsplit(url).hostname
    for line in text.splitlines():
        # Archived ANAC detail pages can consist solely of the platform banner after HTML stripping.
        if host == "pubblicitalegale.anticorruzione.it" and line.strip().removesuffix(
            "-->"
        ).strip() == ("ANAC | Piattaforma di Pubblicità a Valore Legale"):
            continue
        path, separator, value = line.partition(": ")
        if not separator or any(c.isspace() for c in path):
            # These historical index pages had already lost their HTML navigation elements.
            if boamp_index and (
                line.startswith("BOAMP Accueil ")
                or re.match(r"^[^{}]*boamp\.fr\s+\{\{\s*bo_host\s*=", line, re.I)
            ):
                continue
            value = line
        else:
            leaf = path.rsplit(".", 1)[-1]
            if re.search(r"^id(?:$|[A-Z_])|(?:Id|ID|_id)$", leaf):
                continue
        value = URL.sub("", value).strip()
        if value in {"true", "false"} or re.fullmatch(r"(?=.*[0-9])[A-Z0-9_.:-]+", value):
            continue
        if re.fullmatch(r"\d{4}-\d\d-\d\d(?:[T ][\d:.+Z-]+)?", value):
            continue
        if any(c.isalpha() for c in value):
            return True
    return False
