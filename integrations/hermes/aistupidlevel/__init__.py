"""AI Stupid Level provider profile for Hermes Agent.

Registers the AI Stupid Level Smart Router as a provider over its
OpenAI-compatible Chat Completions endpoint. Credential resolution, the
``/model`` picker, ``hermes doctor`` and the ``--provider`` flag all wire up
from the provider registry, so this plugin touches no core files.

The router's model ids are routing modes, not fixed models: ``auto-tooling``
sends each request to the model that currently scores best on AI Stupid
Level's tool-use benchmark, ``auto-coding`` on its coding benchmark, and so on.
The router calls that model with the provider keys saved on the user's AI
Stupid Level account. A model id such as ``claude-opus-5-5`` pins one model.
The live catalog comes from the authenticated ``GET /v1/models``.

Maintained by AI Stupid Level (https://aistupidlevel.info).
"""

from __future__ import annotations

import dataclasses
import logging
from typing import Any

from providers import register_provider
from providers.base import ProviderProfile

logger = logging.getLogger(__name__)

PROVIDER_ID = "aistupidlevel"
API_KEY_ENV = "ASL_ROUTER_KEY"
BASE_URL_ENV = "ASL_BASE_URL"
BASE_URL = "https://aistupidlevel.info/v1"


def _supported_kwargs(cls: type, kwargs: dict[str, Any]) -> dict[str, Any]:
    """Drop profile fields the installed Hermes build does not define.

    Passing a field an older build lacks raises ``TypeError`` at import, which
    the plugin loader swallows, so the provider would silently fail to
    register. Filtering to the fields this build knows degrades gracefully.
    """
    try:
        known = {field.name for field in dataclasses.fields(cls)}
    except TypeError:  # pragma: no cover - non-dataclass profile base
        return dict(kwargs)
    dropped = sorted(set(kwargs) - known)
    if dropped:
        logger.debug("aistupidlevel: this Hermes build has no profile field(s) %s, skipping", ", ".join(dropped))
    return {key: value for key, value in kwargs.items() if key in known}


PROFILE_FIELDS: dict[str, Any] = {
    "name": PROVIDER_ID,
    "aliases": ("asl", "ai-stupid-level"),
    "display_name": "AI Stupid Level",
    "description": "AI Stupid Level Smart Router: each request goes to the model scoring best right now, with your own provider keys",
    "signup_url": "https://aistupidlevel.info/router/keys",
    "env_vars": (API_KEY_ENV, BASE_URL_ENV),
    "base_url": BASE_URL,
    "hostname": "aistupidlevel.info",
    "auth_type": "api_key",
    "api_mode": "chat_completions",
    # The router accepts text only and rejects image input with a clear 400.
    "supports_vision": False,
    # Fast near-top model: suits compression and title generation.
    "default_aux_model": "auto-fastest-quality",
    # Shown only when the live catalog is unreachable: the routing modes, agent-first.
    "fallback_models": (
        "auto-tooling",
        "auto-coding",
        "auto-reasoning",
        "auto-best",
        "auto-task",
        "auto-value",
    ),
}

aistupidlevel = ProviderProfile(**_supported_kwargs(ProviderProfile, PROFILE_FIELDS))

register_provider(aistupidlevel)
