"""Offline unit tests for URL guards, charset decoding and the evidence archive."""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

import pytest

from arch_competition_ops.http import UnsafeUrlError
from arch_competition_ops.http import archive as archive_module
from arch_competition_ops.http.archive import archive_response, extension_for
from arch_competition_ops.http.charset import decode_body, normalize_charset
from arch_competition_ops.http.client import HttpResponse
from arch_competition_ops.http.guards import validate_url

PUBLIC = "93.184.216.34"


def resolve_to(*addresses: str):
    return lambda host: list(addresses)


# -- guards ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.5.4",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "240.0.0.1",
        "::1",
        "::",
        "fe80::1",
        "fc00::1",
        "ff02::1",
        "::ffff:10.1.1.1",
        "::ffff:127.0.0.1",
        "fe80::1%eth0",
    ],
)
def test_non_public_addresses_are_rejected(address: str) -> None:
    with pytest.raises(UnsafeUrlError):
        validate_url("https://host.example/", resolver=resolve_to(address))


@pytest.mark.parametrize("address", [PUBLIC, "2606:4700:4700::1111", "::ffff:93.184.216.34"])
def test_public_addresses_are_accepted(address: str) -> None:
    validate_url("https://host.example/", resolver=resolve_to(address))


def test_every_resolved_address_must_be_public() -> None:
    with pytest.raises(UnsafeUrlError):
        validate_url("https://host.example/", resolver=resolve_to(PUBLIC, "10.0.0.1"))


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://[::1]:8080/",
        "http://10.0.0.1:81/x",
        "http://[::ffff:10.0.0.1]/",
    ],
)
def test_ip_literals_are_checked_without_resolver(url: str) -> None:
    def forbidden(host: str):
        raise AssertionError("resolver must not be used for IP literals")

    with pytest.raises(UnsafeUrlError):
        validate_url(url, resolver=forbidden)


@pytest.mark.parametrize("host", ["localhost", "LOCALHOST", "localhost.", "app.localhost"])
def test_localhost_names_are_rejected_without_resolving(host: str) -> None:
    def forbidden(name: str):
        raise AssertionError("resolver must not be used for localhost")

    with pytest.raises(UnsafeUrlError):
        validate_url(f"http://{host}/", resolver=forbidden)


@pytest.mark.parametrize(
    "url", ["file:///etc/passwd", "ftp://example.org/", "gopher://example.org/", "javascript:1"]
)
def test_only_http_and_https_schemes_are_allowed(url: str) -> None:
    with pytest.raises(UnsafeUrlError):
        validate_url(url, resolver=resolve_to(PUBLIC))
    with pytest.raises(UnsafeUrlError):
        validate_url(url, resolver=resolve_to(PUBLIC), allow_private_hosts=True)


def test_missing_host_and_empty_resolution_are_rejected() -> None:
    with pytest.raises(UnsafeUrlError, match="no host"):
        validate_url("http:///path", resolver=resolve_to(PUBLIC))
    with pytest.raises(UnsafeUrlError, match="no addresses"):
        validate_url("http://host.example/", resolver=resolve_to())


def test_allow_private_hosts_skips_resolution() -> None:
    def forbidden(host: str):
        raise AssertionError("resolver must not be called")

    validate_url("http://localhost:3000/", resolver=forbidden, allow_private_hosts=True)
    validate_url("http://10.0.0.1/", resolver=forbidden, allow_private_hosts=True)


def test_error_carries_url() -> None:
    with pytest.raises(UnsafeUrlError) as info:
        validate_url("http://10.0.0.1/secret", resolver=resolve_to(PUBLIC))
    assert info.value.url == "http://10.0.0.1/secret"
    assert "http://10.0.0.1/secret" in str(info.value)


# -- charset ---------------------------------------------------------------------------------

CHINESE = "建筑设计竞赛报名通知，截止日期为二〇二六年。"


def test_header_charset_gbk_is_decoded() -> None:
    assert decode_body(CHINESE.encode("gbk"), "text/html; charset=GBK") == CHINESE


def test_gb2312_label_decodes_characters_beyond_gb2312() -> None:
    text = "龘䶮"  # outside GB2312, inside GB18030
    assert decode_body(text.encode("gb18030"), "text/html; charset=gb2312") == text


def test_meta_charset_is_detected() -> None:
    html = f'<html><head><meta charset="gb2312"></head><body>{CHINESE}</body></html>'
    assert decode_body(html.encode("gbk")) == html


def test_meta_http_equiv_content_charset_is_detected() -> None:
    html = (
        '<html><head><META HTTP-EQUIV="Content-Type" '
        f'content="text/html; charset=GBK"></head><body>{CHINESE}</body></html>'
    )
    assert decode_body(html.encode("gbk")) == html


def test_xml_declaration_is_detected() -> None:
    xml = f'<?xml version="1.0" encoding="GB2312"?><root>{CHINESE}</root>'
    assert decode_body(xml.encode("gbk")) == xml


def test_only_first_4096_bytes_are_sniffed() -> None:
    padding = "<!-- " + "x" * 5000 + " -->"
    html = f'{padding}<meta charset="gbk"><p>{CHINESE}</p>'
    # The late declaration is ignored, so this falls through to the statistical guess; the
    # important property is that decoding never raises.
    assert isinstance(decode_body(html.encode("gbk")), str)


@pytest.mark.parametrize(
    "bom,codec",
    [
        (b"\xef\xbb\xbf", "utf-8"),
        (b"\xff\xfe", "utf-16-le"),
        (b"\xfe\xff", "utf-16-be"),
    ],
)
def test_bom_is_honoured_and_stripped(bom: bytes, codec: str) -> None:
    assert decode_body(bom + "héllo 建筑".encode(codec)) == "héllo 建筑"


def test_utf8_bom_is_stripped_even_when_header_declares_utf8() -> None:
    assert decode_body(b"\xef\xbb\xbf" + b'{"a": 1}', "application/json; charset=utf-8") == (
        '{"a": 1}'
    )


def test_utf8_is_the_default() -> None:
    assert decode_body(CHINESE.encode("utf-8")) == CHINESE
    assert decode_body(CHINESE.encode("utf-8"), "text/html") == CHINESE


def test_wrong_header_charset_falls_through_to_next_candidate() -> None:
    # Header claims latin-1-incompatible ascii but body is real UTF-8 with a utf-8 meta tag.
    html = f'<meta charset="utf-8">{CHINESE}'
    assert decode_body(html.encode("utf-8"), "text/html; charset=ascii") == html


@pytest.mark.parametrize("label", ["x-no-such-charset", "", "utf-8\x00", "'bogus'"])
def test_unknown_charset_names_are_tolerated(label: str) -> None:
    assert normalize_charset(label) is None
    assert decode_body(CHINESE.encode("utf-8"), f"text/html; charset={label}") == CHINESE
    meta = f'<meta charset="{label}">{CHINESE}'
    assert decode_body(meta.encode("utf-8")) == meta


def test_undecodable_bytes_never_raise() -> None:
    result = decode_body(b"\x81\x8d\x8f\x90\x9d plain \xff\xfe\xfd")
    assert isinstance(result, str)
    assert "plain" in result


def test_empty_content_is_empty_string() -> None:
    assert decode_body(b"", "text/html; charset=gbk") == ""


def test_response_text_uses_header_charset() -> None:
    response = HttpResponse(
        url="https://example.cn/",
        status_code=200,
        headers={"Content-Type": "text/html; charset=gbk"},
        content=CHINESE.encode("gbk"),
    )
    assert response.text == CHINESE


# -- archive ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "content_type,ext",
    [
        ("text/html; charset=utf-8", "html"),
        ("application/xhtml+xml", "html"),
        ("application/json", "json"),
        ("application/ld+json", "json"),
        ("text/xml", "xml"),
        ("application/pdf", "pdf"),
        ("text/csv", "csv"),
        ("text/plain", "txt"),
        ("application/octet-stream", "bin"),
        (None, "bin"),
    ],
)
def test_extension_inference(content_type: str | None, ext: str) -> None:
    assert extension_for(content_type) == ext


def test_archive_writes_sha1_named_content_and_metadata(tmp_path: Path) -> None:
    content = b"<html>evidence</html>"
    digest = hashlib.sha1(content).hexdigest()

    path = archive_response(
        tmp_path,
        url="https://example.org/a",
        final_url="https://example.org/b",
        status_code=200,
        content_type="text/html",
        content=content,
    )

    assert path == tmp_path / f"{digest}.html"
    assert path.read_bytes() == content
    meta = json.loads((tmp_path / f"{digest}.json").read_text(encoding="utf-8"))
    assert meta["url"] == "https://example.org/a"
    assert meta["final_url"] == "https://example.org/b"
    assert meta["status_code"] == 200
    assert meta["content_type"] == "text/html"
    assert meta["sha1"] == digest
    assert meta["bytes"] == len(content)
    assert meta["fetched_at"].endswith("+00:00")
    assert not [p for p in tmp_path.iterdir() if p.suffix == ".tmp"]


def test_archive_same_content_keeps_all_fetch_history(tmp_path: Path) -> None:
    content = b"same"
    for url in ("https://a.example/", "https://b.example/"):
        archive_response(
            tmp_path,
            url=url,
            final_url=url,
            status_code=200,
            content_type="text/plain",
            content=content,
        )

    digest = hashlib.sha1(content).hexdigest()
    meta = json.loads((tmp_path / f"{digest}.json").read_text(encoding="utf-8"))
    assert meta["url"] == "https://b.example/"  # latest fetch at top level
    assert [f["url"] for f in meta["fetches"]] == ["https://a.example/", "https://b.example/"]
    assert meta["first_fetched_at"] == meta["fetches"][0]["fetched_at"]
    assert len(list(tmp_path.iterdir())) == 2  # one content file, one metadata file


def test_archive_does_not_rewrite_existing_content(tmp_path: Path) -> None:
    kwargs = dict(url="u", final_url="u", status_code=200, content_type="text/plain")
    first = archive_response(tmp_path, content=b"data", **kwargs)
    mtime = first.stat().st_mtime_ns
    archive_response(tmp_path, content=b"data", **kwargs)
    assert first.stat().st_mtime_ns == mtime


def test_archive_recovers_from_corrupt_metadata(tmp_path: Path) -> None:
    digest = hashlib.sha1(b"x").hexdigest()
    (tmp_path / f"{digest}.json").write_text("{not json", encoding="utf-8")

    path = archive_response(
        tmp_path, url="u", final_url="u", status_code=200, content_type=None, content=b"x"
    )

    assert path == tmp_path / f"{digest}.bin"
    meta = json.loads((tmp_path / f"{digest}.json").read_text(encoding="utf-8"))
    assert len(meta["fetches"]) == 1


def test_archive_failure_returns_none_and_logs_warning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken_replace(src: object, dst: object) -> None:
        raise PermissionError("read-only volume")

    monkeypatch.setattr(archive_module.os, "replace", broken_replace)

    with caplog.at_level(logging.WARNING, logger="arch_competition_ops.http.archive"):
        result = archive_response(
            tmp_path,
            url="https://example.org/x",
            final_url="https://example.org/x",
            status_code=200,
            content_type="text/html",
            content=b"data",
        )

    assert result is None
    assert any("https://example.org/x" in record.getMessage() for record in caplog.records)
    assert not [p for p in tmp_path.iterdir() if p.suffix == ".tmp"]
