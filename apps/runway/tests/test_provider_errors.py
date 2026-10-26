from types import SimpleNamespace

from fashion_runway.providers import safe_provider_error


def test_rejected_http_status_is_diagnostic_and_not_uncertain():
    error = RuntimeError("secret-key and full provider body must not be copied")
    error.status_code = 401
    error.request_id = "request-safe-123"
    result = safe_provider_error("LLM", error)
    assert result.code == "LLM_HTTP_401"
    assert not result.uncertain
    assert result.details["requestId"] == "request-safe-123"
    assert "secret-key" not in str(result.details)


def test_transport_failure_preserves_only_exception_types():
    error = ConnectionError("private URL?key=secret")
    error.__cause__ = TimeoutError("private endpoint")
    result = safe_provider_error("IMAGE", error)
    assert result.uncertain
    assert result.details == {"causeClass": "ConnectionError", "underlyingCauseClass": "TimeoutError"}


def test_google_http_code_and_response_header_are_safe():
    error = RuntimeError("SDK payload")
    error.code = 429
    error.response = SimpleNamespace(headers={"x-request-id": "safe-request-id"})
    result = safe_provider_error("IMAGE", error)
    assert result.code == "IMAGE_HTTP_429"
    assert not result.uncertain


def test_server_error_is_uncertain_and_constructor_type_error_is_not():
    error = RuntimeError("provider internal error")
    error.status_code = 503
    assert safe_provider_error("LLM", error).uncertain
    assert not safe_provider_error("IMAGE", TypeError("invalid arguments")).uncertain
