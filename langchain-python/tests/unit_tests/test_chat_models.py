"""Standard LangChain unit tests plus the routing metadata."""

from langchain_tests.unit_tests import ChatModelUnitTests

from langchain_aistupidlevel import ChatAISL
from langchain_aistupidlevel.chat_models import _routing_metadata


class TestChatAISLUnit(ChatModelUnitTests):
    @property
    def chat_model_class(self) -> type[ChatAISL]:
        return ChatAISL

    @property
    def chat_model_params(self) -> dict:
        return {"model": "auto-coding", "api_key": "aism_test"}

    @property
    def init_from_env_params(self) -> tuple[dict, dict, dict]:
        return (
            {"ASL_ROUTER_KEY": "aism_env", "ASL_BASE_URL": "https://example.test/v1"},
            {"model": "auto-best"},
            {"openai_api_key": "aism_env", "openai_api_base": "https://example.test/v1"},
        )


def test_defaults_point_at_the_router(monkeypatch):
    monkeypatch.delenv("ASL_BASE_URL", raising=False)
    llm = ChatAISL(api_key="aism_x")
    assert llm.openai_api_base == "https://aistupidlevel.info/v1"
    assert llm.model_name == "auto-best"
    assert llm.include_response_headers is True


def test_sandbox_sets_the_header():
    llm = ChatAISL(api_key="aism_x", sandbox=True, default_headers={"X-Other": "1"})
    assert llm.default_headers == {"X-Other": "1", "X-ASL-Sandbox": "true"}
    assert ChatAISL(api_key="aism_x").default_headers is None


def test_routing_metadata_from_headers():
    meta = _routing_metadata({
        "X-AISM-Model": "claude-opus-5-5", "x-aism-provider": "anthropic",
        "x-aism-reasoning": "Ranked #1", "x-aism-latency": "1420", "x-aism-sandbox": "true",
        "content-type": "application/json",
    })
    assert meta == {"routed_model": "claude-opus-5-5", "routed_provider": "anthropic",
                    "routing_reason": "Ranked #1", "routing_latency_ms": 1420, "sandbox": True}
    assert _routing_metadata(None) == {}
