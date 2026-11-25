"""Distinguish source text from empty data structures and site navigation before billing."""

import re
from urllib.parse import urljoin, urlsplit

from lxml import html

from arch_competition_ops.screening.notice_urls import URL


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


def visible_text(markup, url, *, content_only=False):
    if "<" not in markup:
        return markup, []
    # Archived listings can append a detail fragment after a complete HTML document.
    fragment = re.sub(r"</(?:body|html)\s*>", "", markup, flags=re.I)
    root = html.fragment_fromstring(
        fragment.encode(),
        create_parent="div",
        parser=html.HTMLParser(encoding="utf-8", no_network=True),
    )
    outside = "[not(ancestor::main or ancestor::article)]"
    prune = ["head", "script", "style", "nav", "template", "footer" + outside]
    if content_only:
        prune.extend(["header" + outside, "aside" + outside])
        if url_class(url) == "site_root":
            prune.append("a" + outside)
    selectors = [".//" + tag for tag in prune]
    selectors += [".//*[@hidden or @aria-hidden='true' or @role='navigation']"]
    for node in root.xpath(" | ".join(selectors)):
        node.drop_tree()
    return " ".join(root.itertext()), [urljoin(url, href) for href in root.xpath(".//@href")]


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
