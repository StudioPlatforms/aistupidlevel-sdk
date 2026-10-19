"""AI Stupid Level Smart Router as a Dify model provider.

The router is OpenAI-compatible, so the shared OAICompatLargeLanguageModel does the work. This
class fills in the fixed parts (endpoint, chat mode, tool calling), checks keys without spending a
request, and accepts a chat answer whose `content` is null (an answer that is only tool calls).
"""

import json
from collections.abc import Generator, Mapping

import requests
from dify_plugin import OAICompatLargeLanguageModel
from dify_plugin.entities.model import AIModelEntity, ModelFeature
from dify_plugin.entities.model.llm import LLMResult
from dify_plugin.entities.model.message import PromptMessage, PromptMessageTool
from dify_plugin.errors.model import CredentialsValidateFailedError

BASE_URL = "https://aistupidlevel.info/v1"
CLIENT = "aistupidlevel-dify-plugin/0.0.1"


def check_router_key(credentials: Mapping) -> None:
    """Validate a router key with GET /v1/usage: free, not counted, no provider call."""
    key = (credentials.get("api_key") or "").strip()
    if not key:
        raise CredentialsValidateFailedError("Enter your AI Stupid Level router key (aism_...).")
    try:
        response = requests.get(
            f"{BASE_URL}/usage",
            headers={"Authorization": f"Bearer {key}", "X-ASL-Client": CLIENT},
            timeout=(10, 30),
        )
    except requests.RequestException as ex:
        raise CredentialsValidateFailedError(f"Could not reach AI Stupid Level: {ex}") from ex
    if response.status_code == 401:
        raise CredentialsValidateFailedError(
            "The router key was not accepted. Create one at https://aistupidlevel.info/router/keys"
        )
    if response.status_code != 200:
        try:
            message = response.json()["error"]["message"]
        except Exception:
            message = response.text[:200]
        raise CredentialsValidateFailedError(f"AI Stupid Level returned {response.status_code}: {message}")


class AIStupidLevelLargeLanguageModel(OAICompatLargeLanguageModel):
    @staticmethod
    def _router_credentials(credentials: Mapping) -> dict:
        creds = dict(credentials)
        creds["endpoint_url"] = BASE_URL
        creds["mode"] = "chat"
        creds["function_calling_type"] = "tool_call"
        creds["stream_function_calling"] = "supported"
        creds["extra_headers"] = {**(creds.get("extra_headers") or {}), "X-ASL-Client": CLIENT}
        return creds

    def _invoke(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        user: str | None = None,
    ) -> LLMResult | Generator:
        return super()._invoke(
            model, self._router_credentials(credentials), prompt_messages, model_parameters,
            tools, stop, stream, user,
        )

    def validate_credentials(self, model: str, credentials: dict) -> None:
        check_router_key(credentials)

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool] | None = None,
    ) -> int:
        return super().get_num_tokens(model, self._router_credentials(credentials), prompt_messages, tools)

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        entity = super().get_customizable_model_schema(model, self._router_credentials(credentials))
        for feature in (ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL,
                        ModelFeature.MULTI_TOOL_CALL, ModelFeature.STREAM_TOOL_CALL):
            if feature not in entity.features:
                entity.features.append(feature)
        return entity

    def _handle_generate_response(
        self,
        model: str,
        credentials: dict,
        response: requests.Response,
        prompt_messages: list[PromptMessage],
    ) -> LLMResult:
        # An answer that is only tool calls has `"content": null`; the shared parser needs a string.
        data = response.json()
        for choice in data.get("choices") or []:
            message = choice.get("message")
            if isinstance(message, dict) and message.get("content") is None:
                message["content"] = ""
        response._content = json.dumps(data).encode()
        return super()._handle_generate_response(model, credentials, response, prompt_messages)
