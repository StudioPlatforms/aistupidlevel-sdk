"""Offline tests; the live ones (test_live.py) run against the router's sandbox."""
import json
from unittest.mock import Mock, patch

import pytest
from dify_plugin.entities.model.message import UserPromptMessage
from dify_plugin.errors.model import CredentialsValidateFailedError

from models.llm.llm import BASE_URL, AIStupidLevelLargeLanguageModel, check_router_key


def _resp(status: int, body: dict) -> Mock:
    r = Mock(status_code=status, text=json.dumps(body))
    r.json.return_value = body
    return r


def test_router_credentials_fill_fixed_settings():
    creds = AIStupidLevelLargeLanguageModel._router_credentials({"api_key": "aism_x"})
    assert creds["endpoint_url"] == BASE_URL
    assert creds["mode"] == "chat"
    assert creds["function_calling_type"] == "tool_call"
    assert creds["extra_headers"]["X-ASL-Client"].startswith("aistupidlevel-dify-plugin/")


def test_key_check_uses_free_usage_endpoint():
    with patch("models.llm.llm.requests.get", return_value=_resp(200, {"object": "usage"})) as get:
        check_router_key({"api_key": "aism_x"})
    url = get.call_args.args[0]
    assert url == f"{BASE_URL}/usage"
    assert get.call_args.kwargs["headers"]["Authorization"] == "Bearer aism_x"


@pytest.mark.parametrize("status,body,match", [
    (401, {"error": {"message": "Invalid API key"}}, "not accepted"),
    (500, {"error": {"message": "boom"}}, "500"),
])
def test_key_check_errors(status, body, match):
    with patch("models.llm.llm.requests.get", return_value=_resp(status, body)):
        with pytest.raises(CredentialsValidateFailedError, match=match):
            check_router_key({"api_key": "aism_x"})


def test_missing_key():
    with pytest.raises(CredentialsValidateFailedError):
        check_router_key({})


def test_tool_call_answer_with_null_content():
    body = {"id": "chatcmpl-1", "model": "claude-opus-5-5", "choices": [{"index": 0, "finish_reason": "tool_calls", "message": {
        "role": "assistant", "content": None,
        "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "get_weather", "arguments": "{\"city\":\"Oslo\"}"}}]}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}
    response = Mock()
    response.json.return_value = body
    model = AIStupidLevelLargeLanguageModel(model_schemas=[])
    result = model._handle_generate_response(
        model="auto-tooling",
        credentials=model._router_credentials({"api_key": "aism_x"}),
        response=response,
        prompt_messages=[UserPromptMessage(content="Weather in Oslo?")],
    )
    assert result.message.content == ""
    assert result.message.tool_calls[0].function.name == "get_weather"
