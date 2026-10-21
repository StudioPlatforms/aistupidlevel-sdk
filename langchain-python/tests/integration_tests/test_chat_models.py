"""Standard LangChain integration tests. Needs ASL_ROUTER_KEY.

By default they run in sandbox mode: real routing, mock answers, nothing spent. A mock answer
fills tool arguments with placeholders, so the tests that check the arguments' values are
expected to fail there. Set ASL_LIVE=1 (with provider keys on the account) to run every test
against real models."""

import os

import pytest
from langchain_tests.integration_tests import ChatModelIntegrationTests

from langchain_aistupidlevel import ChatAISL

pytestmark = pytest.mark.skipif(not os.environ.get("ASL_ROUTER_KEY"), reason="ASL_ROUTER_KEY not set")

LIVE = os.environ.get("ASL_LIVE") == "1"


class TestChatAISLIntegration(ChatModelIntegrationTests):
    @property
    def chat_model_class(self) -> type[ChatAISL]:
        return ChatAISL

    @property
    def chat_model_params(self) -> dict:
        return {"model": "auto-tooling", "sandbox": not LIVE, "temperature": 0}

    @property
    def supports_image_inputs(self) -> bool:
        return False  # the router routes text and tool calls only

    @property
    def returns_usage_metadata(self) -> bool:
        return True


def test_routing_metadata_on_invoke():
    msg = ChatAISL(model="auto-coding", sandbox=True).invoke("Write a Python function that reverses a string.")
    assert msg.response_metadata["routed_model"]
    assert msg.response_metadata["routed_provider"]
    assert msg.response_metadata["routing_reason"].startswith("Sandbox")
    assert msg.response_metadata["sandbox"] is True


def test_routing_metadata_on_stream():
    chunks = list(ChatAISL(model="auto-coding", sandbox=True).stream("Say hi."))
    assert any(c.response_metadata.get("routed_model") for c in chunks)
