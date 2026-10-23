"""Live model discovery, its static fallback, and the key check, against a mocked router."""

import httpx
import pytest
import respx
from conftest import MODELS_PAYLOAD, ROUTER

from lfx_aistupidlevel import __version__, discovery


@pytest.fixture
def key(monkeypatch):
    """The key Langflow would hand discovery for this user."""
    monkeypatch.setattr(discovery, "get_provider_variable_value", lambda _user_id, _name: "aism_test")


def _names(rows):
    return [row["name"] for row in rows]


def test_order_puts_routing_modes_first_in_picker_order():
    assert discovery.order_model_ids(MODELS_PAYLOAD["data"]) == [
        "auto-coding",
        "auto-tooling",
        "auto-reasoning",
        "auto-best",
        "auto-value",
        "auto",
        "auto-split",
        "claude-opus-5-5",
        "gpt-6.1-sol",
        "glm-5.3",
    ]


def test_order_keeps_unknown_modes_and_skips_bad_rows():
    data = [{"id": "auto-new", "owned_by": "aistupidlevel"}, {"id": "gpt-x"}, {"id": "gpt-x"}, {"id": ""}, "junk", {}]
    assert discovery.order_model_ids(data) == ["auto-new", "gpt-x"]
    assert discovery.order_model_ids(None) == []


@respx.mock
def test_live_models_come_from_v1_models(key):
    route = respx.get(f"{ROUTER}/models").mock(return_value=httpx.Response(200, json=MODELS_PAYLOAD))
    rows = discovery.fetch_live_models("user-1", "llm")

    request = route.calls.last.request
    assert request.headers["Authorization"] == "Bearer aism_test"
    assert request.headers["User-Agent"] == f"lfx-aistupidlevel/{__version__}"
    assert _names(rows)[:3] == ["auto-coding", "auto-tooling", "auto-reasoning"]
    assert [row["name"] for row in rows if row["default"]] == [
        "auto-coding",
        "auto-tooling",
        "auto-reasoning",
        "auto-best",
        "auto-value",
    ]
    assert all(row["tool_calling"] and row["model_type"] == "llm" for row in rows)
    assert all(row["provider"] == "AI Stupid Level" and row["icon"] == "Gauge" for row in rows)


@respx.mock
def test_live_models_follow_asl_base_url(key, monkeypatch):
    monkeypatch.setenv("ASL_BASE_URL", "http://127.0.0.1:9999/v1/")
    route = respx.get("http://127.0.0.1:9999/v1/models").mock(return_value=httpx.Response(200, json=MODELS_PAYLOAD))
    discovery.fetch_live_models("user-1", "llm")
    assert route.called


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(401, json={"error": {"code": "invalid_api_key"}}),
        httpx.Response(500),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"data": []}),
    ],
)
@respx.mock
def test_live_models_fall_back_to_the_routing_modes(key, response):
    respx.get(f"{ROUTER}/models").mock(return_value=response)
    assert _names(discovery.fetch_live_models("user-1", "llm")) == list(discovery.ROUTING_MODES)


@respx.mock
def test_live_models_fall_back_when_the_router_is_unreachable(key):
    respx.get(f"{ROUTER}/models").mock(side_effect=httpx.ConnectError("refused"))
    assert _names(discovery.fetch_live_models("user-1", "llm")) == list(discovery.ROUTING_MODES)


@respx.mock
def test_no_key_means_no_request(monkeypatch):
    monkeypatch.setattr(discovery, "get_provider_variable_value", lambda _user_id, _name: None)
    route = respx.get(f"{ROUTER}/models")
    assert _names(discovery.fetch_live_models("user-1", "llm")) == list(discovery.ROUTING_MODES)
    assert not route.called


@respx.mock
def test_validate_accepts_a_working_key():
    route = respx.get(f"{ROUTER}/usage").mock(return_value=httpx.Response(200, json={"object": "usage"}))
    discovery.validate_credentials("AI Stupid Level", {"AISTUPIDLEVEL_API_KEY": "aism_good"})
    assert route.calls.last.request.headers["Authorization"] == "Bearer aism_good"


def test_validate_requires_a_key():
    with pytest.raises(ValueError, match="API key is required"):
        discovery.validate_credentials("AI Stupid Level", {})


@pytest.mark.parametrize("status", [401, 403])
@respx.mock
def test_validate_rejects_a_bad_key(status):
    respx.get(f"{ROUTER}/usage").mock(return_value=httpx.Response(status))
    with pytest.raises(ValueError, match="Invalid AI Stupid Level API key"):
        discovery.validate_credentials("AI Stupid Level", {"AISTUPIDLEVEL_API_KEY": "aism_bad"})


@respx.mock
def test_validate_reports_server_errors():
    respx.get(f"{ROUTER}/usage").mock(return_value=httpx.Response(503))
    with pytest.raises(ValueError, match="HTTP 503"):
        discovery.validate_credentials("AI Stupid Level", {"AISTUPIDLEVEL_API_KEY": "aism_x"})


@pytest.mark.parametrize(
    ("error", "message"),
    [(httpx.ConnectError("refused"), "Could not connect"), (httpx.ReadTimeout("slow"), "timed out")],
)
@respx.mock
def test_validate_reports_transport_errors(error, message):
    respx.get(f"{ROUTER}/usage").mock(side_effect=error)
    with pytest.raises(ValueError, match=message):
        discovery.validate_credentials("AI Stupid Level", {"AISTUPIDLEVEL_API_KEY": "aism_x"})
