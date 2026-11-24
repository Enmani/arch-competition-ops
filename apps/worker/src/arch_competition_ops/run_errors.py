"""Safe identifiers for public run reports. Exception text can contain credentials."""

import re
from urllib.parse import urlsplit, urlunsplit


def log_url(value):
    try:
        parts = urlsplit(value)
        if parts.scheme not in {"https", "http"} or not parts.hostname:
            return ""
        host = parts.hostname
        if ":" in host:
            host = f"[{host}]"
        if parts.port:
            host += f":{parts.port}"
        return urlunsplit((parts.scheme, host, parts.path, "", ""))
    except ValueError:
        return ""


def error_class(error):
    status = getattr(error, "status_code", None)
    if isinstance(status, int):
        return f"http_{status}"
    return type(error).__name__


def provider_code(error):
    code = str(error)
    if re.fullmatch(r"http_[1-5]\d\d", code) or code in {
        "invalid_schema",
        "missing_text",
        "incomplete_response",
        "max_tokens",
        "refusal",
        "transport_error",
        "api_error",
        "insufficient_quota",
    }:
        return code
    return error_class(error)
