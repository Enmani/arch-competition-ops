import pytest
from test_ai_screening import (  # noqa: F401
    NOTICE,
    ai_workspace,
    decision_payload,
    mock_client,
    response,
)

from arch_competition_ops.screening.fingerprints import notice_content_hash
from arch_competition_ops.screening.notice_urls import public_url
from arch_competition_ops.screening.service import assess_document


@pytest.mark.parametrize(
    ("original", "safe"),
    [
        ("https://contrataciondelestado.es/poc?uri=deeplink:detalle_licitacion&idEvl=X", True),
        ("https://www.simap.ch/pub?NOTICE_NR=17", True),
        ("https://service.ariba.com/discovery/#/RfxEvent/123", True),
        ("https://portal.example/doc?id=7&uri=https%3A%2F%2Fpublic.example%2Ffile", True),
        ("https://service.ariba.com/discovery/#/RfxEvent/123?token=private", False),
        ("https://portal.example/doc?id=7&token=private", False),
        ("https://portal.example/doc?id=7%2526access_token%253Dprivate", False),
        ("https://portal.example/doc?id=7&uri=https%3A%2F%2Fa.example%3Fsig%3Dprivate", False),
    ],
)
def test_chosen_link_restores_only_safe_original(ai_workspace, original, safe):  # noqa: F811
    settings, source = ai_workspace
    clean = public_url(original)
    model = decision_payload()
    claim = next(c for c in model["extracted_fields"] if c["field"] == "official_url")
    claim.update(value=clean, quote=clean)

    def handler(request):
        assert "private" not in request.content.decode()
        return response(model)

    with mock_client(handler) as client:
        result = assess_document(
            settings,
            source=source,
            source_url="https://city.example/1",
            payload=NOTICE.replace("/competition", original),
            client=client,
        )
    assert result.record.official_url == (original if safe else clean)
    assert "private" not in result.record.evidence_note
    assert ("credential" in result.record.evidence_note) == (not safe)


def test_volatile_page_labels_preserve_substantive_dates():
    def fingerprint(day, visits, nonce, deadline="2026-12-02", published="2026-11-01"):
        html = (
            f"<h1>School</h1><p>Published: {published}. Deadline: {deadline}</p>"
            f"<footer>Page generated at: {day} 12:45:30 UTC | Visits: {visits} | "
            f"CSRF token: {nonce} | Session ID: {nonce} | Nonce: {nonce}</footer>"
        )
        return notice_content_hash(html, "https://city.example/1")

    original = fingerprint("2026-11-24", 450, "abc")
    assert original == fingerprint("2026-11-25", 500, "def")
    assert original != fingerprint("2026-11-24", 450, "abc", deadline="2026-12-03")
    assert original != fingerprint("2026-11-24", 450, "abc", published="2026-11-02")


def test_notice_hash_ignores_page_chrome_but_keeps_article_dates_and_links():
    def version(counter, deadline, href):
        html = (
            f'<nav><a href="/menu/{counter}">Updates {counter}</a></nav>'
            f"<span hidden>Server {counter}</span><article><p>Design brief</p>"
            f'<footer>Deadline {deadline} <a href="{href}">Brief</a></footer></article>'
        )
        return notice_content_hash(html, "https://city.example/1")

    assert version(1, "2027-01-02", "/a") == version(2, "2027-01-02", "/a")
    assert version(1, "2027-01-02", "/a") != version(1, "2027-02-02", "/a")
    assert version(1, "2027-01-02", "/a") != version(1, "2027-01-02", "/b")
