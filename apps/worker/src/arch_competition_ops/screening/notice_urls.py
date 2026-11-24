import ipaddress
import re
from html.parser import HTMLParser
from urllib.parse import parse_qsl, unquote, urlencode, urljoin, urlsplit, urlunsplit

URL = re.compile(r"""https?://[^\s<>"'\\]+""", re.I)


def public_url(value: str) -> str:
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        if (
            url.scheme not in {"http", "https"}
            or "." not in host
            or host.endswith((".local", ".localhost", ".internal"))
        ):
            return ""
        try:
            if not ipaddress.ip_address(host).is_global:
                return ""
        except ValueError:
            pass
        port = f":{url.port}" if url.port else ""
        # Public identifiers survive; unknown query parameters can carry signed credentials.
        query = [
            (k, v)
            for k, v in parse_qsl(url.query)
            if k.lower()
            in {
                "id",
                "noticeid",
                "notice_nr",
                "projectid",
                "oid",
                "publicationid",
                "tenderid",
                "tendno",
                "tendseq",
                "frameworkagreementseq",
                "tendcategcd",
                "intrllocaltypecd",
                "tendmthodcd",
                "invtyn",
                "stenderid",
                "noticeversion",
                "pid",
                "idevl",
                "toid",
                "category",
                "function",
                "meformsnoticeid",
                "projectnumber",
                "docid",
                "resid",
            }
            or (k == "q" and re.fullmatch(r"idweb:[\w-]+", v))
        ]
        identifiers = [
            (k, v) for k, v in query if not _nested_url(v) and not _embedded_credentials(v)
        ]
        route = url.fragment.partition("?")[0]
        fragment = (
            route
            if (host.endswith(".ariba.com") and re.fullmatch(r"/RfxEvent/[\w-]+", route))
            else ""
        )
        return urlunsplit(
            (url.scheme, host + port, url.path, urlencode(sorted(identifiers)), fragment)
        )
    except ValueError:
        return ""


_CREDENTIAL_KEY = re.compile(
    r"token|signature|credential|password|passwd|secret|session|api[-_]?key|"
    r"^(?:sig|key|code|auth|authorization|policy|x-amz-.+|x-goog-.+|jwt|samlresponse)$",
    re.I,
)


def _nested_url(value):
    decoded = unquote(unquote(value))
    return "://" in decoded or decoded.startswith("//")


def _embedded_credentials(value):
    decoded = unquote(unquote(value))
    if re.search(r"(?://)[^/?#]+@", decoded):
        return True
    return any(
        _CREDENTIAL_KEY.search(name) for name in re.findall(r"(?:^|[?&#;])([^?&#;=]+)=", decoded)
    )


def stored_link(original):
    """Restore navigation details only on public links without signed or nested credentials."""
    clean = public_url(original)
    if not clean:
        return "", True
    parts = urlsplit(original)
    # Fragments can be application routes or OAuth callbacks. Inspect both their query and body.
    query = "&".join((parts.query, parts.fragment.split("?", 1)[-1]))
    sensitive = bool(parts.username or parts.password)
    for name, value in parse_qsl(query, keep_blank_values=True):
        if _CREDENTIAL_KEY.search(name) or _embedded_credentials(value):
            sensitive = True
    return (clean, True) if sensitive else (original, False)


class PageLinks(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key == "href" and value:
                absolute = urljoin(self.base_url, value)
                if absolute.startswith(("https://", "http://")):
                    self.links.append(absolute)
