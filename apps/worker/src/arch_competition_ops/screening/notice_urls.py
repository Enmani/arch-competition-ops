import ipaddress
import re
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

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
        identifiers = [(k, v) for k, v in query if "://" not in v and not v.startswith("//")]
        return urlunsplit((url.scheme, host + port, url.path, urlencode(sorted(identifiers)), ""))
    except ValueError:
        return ""


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
