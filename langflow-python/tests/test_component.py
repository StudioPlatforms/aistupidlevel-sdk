"""The AI Stupid Level component, against a mocked router.

Langflow's ``ComponentTestBase`` lives in Langflow's own test tree and cannot be imported from a
standalone extension (lfx-empiriolabs notes the same), so ``test_latest_version`` below repeats its
offline check: build the component from its source on a mock vertex, run every output with
outbound connections refused, and require a value from each.
"""

import inspect
import ipaddress
import socket
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

import httpx
import pytest
import respx
from conftest import MODELS_PAYLOAD, ROUTER
from langchain_aistupidlevel import ChatAISL
from lfx.base.models import provider_registry, unified_models
from lfx.extension import load_extension
from lfx.schema.dotdict import dotdict
from lfx.schema.message import Message

import lfx_aistupidlevel
from lfx_aistupidlevel.components.aistupidlevel import AIStupidLevelComponent
from lfx_aistupidlevel.components.aistupidlevel.aistupidlevel import routing_from_metadata
from lfx_aistupidlevel.discovery import ROUTING_MODES


@pytest.fixture(scope="module", autouse=True)
def _provider_registered():
    """Langflow registers the provider whenever it loads this component; the key lookup needs it."""
    provider_registry.clear()
    assert load_extension(Path(lfx_aistupidlevel.__file__).parent).ok
    yield
    provider_registry.clear()


REASON = "Selected claude-opus-5-5 from anthropic for best coding performance."
ROUTING_HEADERS = {
    "X-AISM-Model": "claude-opus-5-5",
    "X-AISM-Provider": "anthropic",
    "X-AISM-Reasoning": REASON,
    "X-AISM-Request-Id": "chatcmpl-test",
}
COMPLETION = {
    "id": "chatcmpl-test",
    "object": "chat.completion",
    "created": 1792750000,
    # Differs from X-AISM-Model so the tests show the header is what gets reported.
    "model": "claude-opus-5-5-snapshot",
    "choices": [
        {
            "index": 0,
            "message": {"role": "assistant", "content": "def reverse(s):\n    return s[::-1]"},
            "finish_reason": "stop",
        }
    ],
    "usage": {"prompt_tokens": 12, "completion_tokens": 9, "total_tokens": 21},
}
DEFAULT_KWARGS = {
    "api_key": "aism_test",
    "model": "auto-coding",
    "input_value": "Write a Python function that reverses a string.",
    "temperature": 0.1,
    "max_tokens": 0,
    "stream": False,
}


def _component(**overrides) -> AIStupidLevelComponent:
    component = AIStupidLevelComponent()
    component.set_attributes({**DEFAULT_KWARGS, **overrides})
    return component


def _chat_output_label(component) -> str:
    """The attribute lookup Chat Output uses to label a message with its model."""
    for attribute in ("model_name", "model_id", "model"):
        if hasattr(component, attribute) and getattr(component, attribute):
            return getattr(component, attribute)
    return ""


@pytest.fixture
def router():
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{ROUTER}/chat/completions").mock(
            return_value=httpx.Response(200, json=COMPLETION, headers=ROUTING_HEADERS)
        )
        mock.get(f"{ROUTER}/models").mock(return_value=httpx.Response(200, json=MODELS_PAYLOAD))
        yield mock


def _is_loopback(address) -> bool:
    if isinstance(address, str | bytes):
        return True
    try:
        return address[0] == "localhost" or ipaddress.ip_address(str(address[0]).split("%", 1)[0]).is_loopback
    except (ValueError, TypeError, IndexError):
        return False


async def test_latest_version(router):
    """ComponentTestBase.test_latest_version, ported: every output runs offline and returns a value."""
    vertex = Mock()
    vertex.id = str(uuid4())
    vertex.incoming_edges = []
    vertex.outgoing_edges = []
    vertex.edges_source_names = set()
    vertex._accumulate_upstream_token_usage = Mock(return_value=None)
    vertex.graph = Mock()
    vertex.graph.user_id = None
    vertex.graph.id = vertex.graph.session_id = vertex.graph.flow_id = vertex.graph.run_id = str(uuid4())
    vertex.graph.context = dotdict()
    vertex.graph.vertices = []
    vertex.is_output = Mock(return_value=False)

    component = AIStupidLevelComponent(_code=inspect.getsource(AIStupidLevelComponent), **DEFAULT_KWARGS)
    component._vertex = vertex
    component.log = Mock()

    attempts = []
    connect = socket.socket.connect

    def guarded_connect(sock, address):
        if not _is_loopback(address):
            attempts.append(address)
            raise ConnectionRefusedError(address)
        connect(sock, address)

    with patch.object(socket.socket, "connect", guarded_connect):
        results, _artifacts = await component.run()

    assert not attempts
    assert set(results) == set(component.list_outputs()) == {"text_output", "model_output"}
    assert all(value is not None for value in results.values())
    assert isinstance(results["model_output"], ChatAISL)
    assert results["text_output"].text.startswith("def reverse")


async def test_shows_which_model_answered(router):
    component = _component()
    assert _chat_output_label(component) == "auto-coding"  # before the call: the requested mode

    message = await component.text_response()

    assert isinstance(message, Message)
    assert message.properties.source.source == "claude-opus-5-5"
    assert component.model_id == "claude-opus-5-5"
    assert _chat_output_label(component) == "claude-opus-5-5"  # what Chat Output shows beside the message
    [log] = [entry for entry in component._logs if entry.name == "Routing"]
    assert log.message == f"Answered by claude-opus-5-5 (anthropic). {REASON}"

    request = router.calls.last.request
    assert request.headers["Authorization"] == "Bearer aism_test"
    assert b'"model":"auto-coding"' in request.content.replace(b" ", b"")


def test_build_model():
    llm = _component(temperature=0.3, max_tokens=512).build_model()
    assert isinstance(llm, ChatAISL)
    assert llm.model_name == "auto-coding"
    assert llm.openai_api_key.get_secret_value() == "aism_test"
    assert llm.openai_api_base == "https://aistupidlevel.info/v1"
    assert llm.temperature == 0.3
    assert llm.max_tokens == 512
    assert llm.streaming is False


def test_build_model_follows_asl_base_url(monkeypatch):
    monkeypatch.setenv("ASL_BASE_URL", "http://127.0.0.1:18781/v1")
    assert _component().build_model().openai_api_base == "http://127.0.0.1:18781/v1"


def test_key_field_starts_empty():
    # A default such as "AISTUPIDLEVEL_API_KEY" would make Langflow look up a global variable of
    # that name, and the editor's run path fails when it is missing instead of using the environment.
    [key_input] = [i for i in AIStupidLevelComponent.inputs if i.name == "api_key"]
    assert not key_input.value


def test_empty_field_uses_the_key_saved_for_the_provider(monkeypatch):
    calls = []

    def saved_key(user_id, provider, api_key):
        calls.append((provider, api_key))
        return "aism_saved"

    monkeypatch.setattr(unified_models, "get_api_key_for_provider", saved_key)
    assert _component(api_key="").build_model().openai_api_key.get_secret_value() == "aism_saved"
    assert calls == [("AI Stupid Level", None)]


@pytest.mark.parametrize("env_name", ["AISTUPIDLEVEL_API_KEY", "ASL_ROUTER_KEY"])
def test_key_falls_back_to_the_environment(monkeypatch, env_name):
    monkeypatch.setenv(env_name, f"aism_{env_name.lower()}")
    llm = _component(api_key="").build_model()
    assert llm.openai_api_key.get_secret_value() == f"aism_{env_name.lower()}"


def test_provider_variable_wins_over_asl_router_key(monkeypatch):
    monkeypatch.setenv("AISTUPIDLEVEL_API_KEY", "aism_first")
    monkeypatch.setenv("ASL_ROUTER_KEY", "aism_second")
    assert _component(api_key=None).build_model().openai_api_key.get_secret_value() == "aism_first"


def test_missing_key_is_explained():
    with pytest.raises(ValueError, match="AI Stupid Level API key is required"):
        _component(api_key="").build_model()


def test_no_environment_fallback_when_langflow_forbids_it(monkeypatch):
    from lfx.services.variable.request_scope import activate_no_env_fallback, reset_no_env_fallback

    monkeypatch.setenv("ASL_ROUTER_KEY", "aism_server_key")
    token = activate_no_env_fallback(disabled=True)
    try:
        with pytest.raises(ValueError, match="API key is required"):
            _component(api_key="").build_model()
    finally:
        reset_no_env_fallback(token)


def test_refresh_loads_every_mode_and_model(router):
    component = _component()
    config = {"model": {"options": list(ROUTING_MODES), "value": "auto-coding"}}
    updated = component.update_build_config(config, None, "model")
    assert updated["model"]["options"][0] == "auto-coding"
    assert "claude-opus-5-5" in updated["model"]["options"]
    assert router.calls.last.request.headers["Authorization"] == "Bearer aism_test"


@respx.mock
def test_refresh_falls_back_to_the_routing_modes():
    respx.get(f"{ROUTER}/models").mock(return_value=httpx.Response(401))
    config = {"model": {"options": [], "value": "auto-coding"}}
    updated = _component().update_build_config(config, None, "model")
    assert updated["model"]["options"] == list(ROUTING_MODES)


def test_default_model_is_auto_coding():
    [model_input] = [i for i in AIStupidLevelComponent.inputs if i.name == "model"]
    assert model_input.value == "auto-coding"
    assert model_input.options[0] == "auto-coding"


def test_routing_from_metadata():
    assert routing_from_metadata(
        {"routed_model": "gpt-6.1-sol", "routed_provider": "openai", "routing_reason": "Ranked #1", "sandbox": True}
    ) == {"model": "gpt-6.1-sol", "provider": "openai", "reason": "Ranked #1", "sandbox": True}
    # Without the X-AISM headers, the response's model field still names the model.
    assert routing_from_metadata({"model_name": "glm-5.3"}) == {"model": "glm-5.3"}
    assert routing_from_metadata({}) == {}
    assert routing_from_metadata(None) == {}
