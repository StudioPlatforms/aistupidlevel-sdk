"""Live tests against the router in sandbox mode (real routing, mock answers, nothing spent).
Run with ASL_ROUTER_KEY=aism_... pytest; skipped without a key."""
import os

import pytest
from dify_plugin.entities.model.message import UserPromptMessage
from dify_plugin.entities.model.message import PromptMessageTool

from models.llm.llm import AIStupidLevelLargeLanguageModel, check_router_key

KEY = os.environ.get("ASL_ROUTER_KEY")
pytestmark = pytest.mark.skipif(not KEY, reason="set ASL_ROUTER_KEY")
CREDS = {"api_key": KEY, "extra_headers": {"X-ASL-Sandbox": "true"}}


def test_key_check():
    check_router_key({"api_key": KEY})


def test_blocking_and_streaming():
    model = AIStupidLevelLargeLanguageModel(model_schemas=[])
    prompt = [UserPromptMessage(content="Write a function that reverses a string.")]
    result = model._invoke("auto-coding", dict(CREDS), prompt, {"max_tokens": 256}, stream=False)
    assert result.message.content.startswith("Sandbox response")
    chunks = list(model._invoke("auto-best", dict(CREDS), prompt, {"max_tokens": 256}, stream=True))
    assert "".join(c.delta.message.content or "" for c in chunks).startswith("Sandbox response")


def test_tool_call():
    model = AIStupidLevelLargeLanguageModel(model_schemas=[])
    tool = PromptMessageTool(name="get_weather", description="Weather for a city",
                             parameters={"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]})
    result = model._invoke("auto-tooling", dict(CREDS), [UserPromptMessage(content="Weather in Oslo?")],
                           {"max_tokens": 256}, tools=[tool], stream=False)
    assert result.message.tool_calls and result.message.tool_calls[0].function.name == "get_weather"
