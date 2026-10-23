# No ``from __future__ import annotations`` here: Langflow reads the output methods' return
# annotations to type the component's outputs.
import os
from typing import Any

import httpx
from langchain_aistupidlevel import ChatAISL
from lfx.base.models.model import LCModelComponent
from lfx.field_typing import LanguageModel
from lfx.field_typing.range_spec import RangeSpec
from lfx.inputs.inputs import DropdownInput, IntInput, SecretStrInput, SliderInput
from lfx.schema.message import Message
from lfx.schema.properties import Source

from lfx_aistupidlevel.discovery import (
    DEFAULT_MODEL,
    KEYS_URL,
    PROVIDER,
    ROUTING_MODES,
    base_url,
    fetch_model_ids,
)

# The key name the other AI Stupid Level SDKs read, accepted when no other key is set.
ROUTER_KEY_ENV = "ASL_ROUTER_KEY"


def _secret(value: Any) -> str:
    if hasattr(value, "get_secret_value"):
        value = value.get_secret_value()
    return value.strip() if isinstance(value, str) else ""


def _env_fallback_allowed() -> bool:
    """False while Langflow serves a flow that must not read the server's environment."""
    try:
        from lfx.services.variable.request_scope import is_env_fallback_disabled
    except ImportError:
        return True
    return not is_env_fallback_disabled()


def routing_from_metadata(metadata: Any) -> dict[str, Any]:
    """Which model answered and why.

    ChatAISL copies the router's ``X-AISM-*`` response headers into ``response_metadata``; without
    them, the response's ``model`` field (``model_name``) still names the model that answered.
    """
    if not isinstance(metadata, dict):
        return {}
    model = metadata.get("routed_model") or metadata.get("model_name")
    if not model:
        return {}
    routing: dict[str, Any] = {"model": model}
    for key, name in (
        ("routed_provider", "provider"),
        ("routing_reason", "reason"),
        ("routing_request_id", "request_id"),
    ):
        if metadata.get(key):
            routing[name] = metadata[key]
    if metadata.get("sandbox"):
        routing["sandbox"] = True
    return routing


class AIStupidLevelComponent(LCModelComponent):
    display_name = "AI Stupid Level"
    description = (
        "Sends each request to the model that scores best on AI Stupid Level's benchmarks for the "
        "chosen routing mode, using your own provider keys."
    )
    documentation = "https://aistupidlevel.info/router/docs"
    icon = "Gauge"
    name = "AIStupidLevelModel"

    inputs = [
        *LCModelComponent.get_base_inputs(),
        SecretStrInput(
            name="api_key",
            display_name="AI Stupid Level API Key",
            info=(
                f"Router key (aism_...) from {KEYS_URL}. Leave empty to use the key saved for AI Stupid "
                "Level in Settings → Model Providers, or the AISTUPIDLEVEL_API_KEY or ASL_ROUTER_KEY "
                "environment variable."
            ),
            required=False,
            real_time_refresh=True,
        ),
        DropdownInput(
            name="model",
            display_name="Model",
            info=(
                "A routing mode such as auto-coding, or a model id to pin. The modes are described at "
                "https://aistupidlevel.info/router/docs#strategies."
            ),
            options=list(ROUTING_MODES),
            value=DEFAULT_MODEL,
            refresh_button=True,
            combobox=True,
        ),
        SliderInput(
            name="temperature",
            display_name="Temperature",
            value=0.1,
            range_spec=RangeSpec(min=0, max=2, step=0.01),
            advanced=True,
        ),
        IntInput(
            name="max_tokens",
            display_name="Max Tokens",
            info="Maximum number of tokens to generate. 0 sets no explicit limit.",
            advanced=True,
            range_spec=RangeSpec(min=0, max=64000),
        ),
    ]

    # Routing facts of the last answer: model, provider, reason, request_id.
    _routing: dict | None = None

    @property
    def model_id(self) -> str | None:
        """The model that answered the last request. Chat Output shows it beside the message."""
        return (self._routing or {}).get("model")

    def _api_key(self) -> str:
        """This component's key, else the provider's (Settings or AISTUPIDLEVEL_API_KEY), else ASL_ROUTER_KEY."""
        key = _secret(self.api_key)
        if key:
            return key
        try:
            # The lookup the Language Model and Agent components use for this provider.
            from lfx.base.models.unified_models import get_api_key_for_provider

            key = _secret(get_api_key_for_provider(self.user_id, PROVIDER, None))
        except Exception:  # noqa: BLE001 - no saved key, or no variable service outside a Langflow server
            key = ""
        if key or not _env_fallback_allowed():
            return key
        return os.environ.get(ROUTER_KEY_ENV, "").strip()

    def fetch_models(self) -> list[str]:
        """Routing modes and pinnable models from the router, or the routing modes alone."""
        api_key = self._api_key()
        if not api_key:
            return list(ROUTING_MODES)
        try:
            model_ids = fetch_model_ids(api_key)
        except (httpx.HTTPError, ValueError) as e:
            self.log(f"Could not load the model list, showing the routing modes: {e}")
            return list(ROUTING_MODES)
        return model_ids or list(ROUTING_MODES)

    def update_build_config(self, build_config: dict, field_value: Any, field_name: str | None = None) -> dict:  # noqa: ARG002
        if field_name in {"api_key", "model"} and "model" in build_config:
            build_config["model"]["options"] = self.fetch_models()
        return build_config

    def build_model(self) -> LanguageModel:  # type: ignore[type-var]
        api_key = self._api_key()
        if not api_key:
            msg = (
                "An AI Stupid Level API key is required: enter it in this component, save it in "
                "Settings → Model Providers → AI Stupid Level, or set AISTUPIDLEVEL_API_KEY. "
                f"Create a router key at {KEYS_URL}."
            )
            raise ValueError(msg)
        kwargs: dict[str, Any] = {
            "model": self.model or DEFAULT_MODEL,
            "api_key": api_key,
            "base_url": base_url(),
            "streaming": bool(self.stream),
        }
        if self.temperature is not None:
            kwargs["temperature"] = self.temperature
        if self.max_tokens:
            kwargs["max_tokens"] = int(self.max_tokens)
        return ChatAISL(**kwargs)

    def build_status_message(self, message):
        # Called with the model's AIMessage, the one place its response_metadata is available.
        self._routing = routing_from_metadata(getattr(message, "response_metadata", None)) or None
        return super().build_status_message(message)

    async def text_response(self) -> Message:
        self._routing = None
        result = await super().text_response()
        routing = self._routing
        if routing and isinstance(result, Message):
            result.properties.source = Source(id=self._id, display_name=self.display_name, source=routing["model"])
            answered_by = routing["model"] + (f" ({routing['provider']})" if routing.get("provider") else "")
            self.log(f"Answered by {answered_by}. {routing.get('reason', '')}".strip(), name="Routing")
        return result
