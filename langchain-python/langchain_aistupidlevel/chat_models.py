"""ChatAISL: the AI Stupid Level Smart Router as a LangChain chat model."""

from __future__ import annotations

import os
from typing import Any, AsyncIterator, Iterator

from langchain_core.outputs import ChatGenerationChunk, ChatResult
from langchain_openai.chat_models.base import BaseChatOpenAI
from pydantic import Field, SecretStr, model_validator

DEFAULT_BASE_URL = "https://aistupidlevel.info/v1"

# Response headers that say which model answered and why, copied into response_metadata.
_ROUTING_HEADERS = {
    "x-aism-model": "routed_model",
    "x-aism-provider": "routed_provider",
    "x-aism-reasoning": "routing_reason",
    "x-aism-latency": "routing_latency_ms",
    "x-aism-request-id": "routing_request_id",
}


def _routing_metadata(headers: dict | None) -> dict:
    """The routing facts from the router's response headers."""
    if not headers:
        return {}
    lower = {str(k).lower(): v for k, v in headers.items()}
    out = {name: lower[h] for h, name in _ROUTING_HEADERS.items() if lower.get(h)}
    if "routing_latency_ms" in out:
        try:
            out["routing_latency_ms"] = int(out["routing_latency_ms"])
        except ValueError:
            out.pop("routing_latency_ms")
    if lower.get("x-aism-sandbox") == "true":
        out["sandbox"] = True
    return out


class ChatAISL(BaseChatOpenAI):
    """Chat model for the AI Stupid Level Smart Router.

    Instead of a fixed model, pass a routing mode such as ``auto-coding``, ``auto-reasoning``,
    ``auto-tooling``, ``auto-best`` or ``auto-value``. Each request goes to the model that scores
    best for that mode on AI Stupid Level's benchmarks, among the providers you connected, and is
    called with your own provider keys. A model id such as ``claude-opus-5-5`` pins that model.

    Setup:
        .. code-block:: bash

            pip install -U langchain-aistupidlevel
            export ASL_ROUTER_KEY="aism_..."   # https://aistupidlevel.info/router/keys

    Instantiate:
        .. code-block:: python

            from langchain_aistupidlevel import ChatAISL

            llm = ChatAISL(model="auto-coding")

    Invoke:
        .. code-block:: python

            msg = llm.invoke("Write a Python function that reverses a string.")
            msg.content
            msg.response_metadata["routed_model"]    # e.g. "claude-opus-5-5"
            msg.response_metadata["routing_reason"]  # why the router chose it

    Sandbox (real routing, mock answers, nothing spent or counted):
        .. code-block:: python

            llm = ChatAISL(model="auto-coding", sandbox=True)

    Tool calling, structured output and streaming work as with ``ChatOpenAI``.
    """

    model_name: str = Field(default="auto-best", alias="model")
    """A routing mode (``auto-coding``, ``auto-best``, …) or a model id to pin."""

    openai_api_key: SecretStr | None = Field(
        alias="api_key",
        default_factory=lambda: SecretStr(os.environ["ASL_ROUTER_KEY"]) if os.environ.get("ASL_ROUTER_KEY") else None,
    )
    """Router key (``aism_…``). Read from ``ASL_ROUTER_KEY`` when not given."""

    openai_api_base: str | None = Field(
        alias="base_url",
        default_factory=lambda: os.environ.get("ASL_BASE_URL") or DEFAULT_BASE_URL,
    )
    """Router endpoint. Read from ``ASL_BASE_URL`` when set."""

    sandbox: bool = False
    """Real routing with a mock answer: nothing is sent to a model or counted."""

    stream_usage: bool | None = True
    """Ask for token usage at the end of a stream, as ChatOpenAI does for OpenAI."""

    include_response_headers: bool = True
    """Kept on so the routing headers can be copied into ``response_metadata``."""

    @model_validator(mode="before")
    @classmethod
    def _sandbox_header(cls, values: Any) -> Any:
        if isinstance(values, dict) and values.get("sandbox"):
            headers = dict(values.get("default_headers") or {})
            headers["X-ASL-Sandbox"] = "true"
            values["default_headers"] = headers
        return values

    @property
    def _llm_type(self) -> str:
        return "aistupidlevel-chat"

    @property
    def lc_secrets(self) -> dict[str, str]:
        return {"openai_api_key": "ASL_ROUTER_KEY"}

    @classmethod
    def get_lc_namespace(cls) -> list[str]:
        return ["langchain_aistupidlevel", "chat_models"]

    @classmethod
    def is_lc_serializable(cls) -> bool:
        # langchain-core only revives classes it lists in its own mapping, so a
        # serialized ChatAISL could not be loaded again.
        return False

    def _get_ls_params(self, stop: list[str] | None = None, **kwargs: Any) -> Any:
        params = super()._get_ls_params(stop=stop, **kwargs)
        params["ls_provider"] = "aistupidlevel"
        return params

    def _create_chat_result(self, response: Any, generation_info: dict | None = None) -> ChatResult:
        result = super()._create_chat_result(response, generation_info)
        routing = _routing_metadata((generation_info or {}).get("headers"))
        if routing:
            for gen in result.generations:
                gen.message.response_metadata.update(routing)
        return result

    def _stream(self, *args: Any, **kwargs: Any) -> Iterator[ChatGenerationChunk]:
        for chunk in super()._stream(*args, **kwargs):
            routing = _routing_metadata((chunk.generation_info or {}).get("headers"))
            if routing:
                chunk.message.response_metadata.update(routing)
            yield chunk

    async def _astream(self, *args: Any, **kwargs: Any) -> AsyncIterator[ChatGenerationChunk]:
        async for chunk in super()._astream(*args, **kwargs):
            routing = _routing_metadata((chunk.generation_info or {}).get("headers"))
            if routing:
                chunk.message.response_metadata.update(routing)
            yield chunk
