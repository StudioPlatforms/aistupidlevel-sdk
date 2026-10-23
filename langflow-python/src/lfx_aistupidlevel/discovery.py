"""Model discovery and key validation for the AI Stupid Level provider.

``extension.json`` names three callables here, and Langflow's provider registry imports them only
when it needs them:

- :func:`load_static_catalog` lists the routing modes. Langflow shows them before a key is set, and
  discovery falls back to them when the router cannot be reached.
- :func:`fetch_live_models` reads ``GET /v1/models`` with the user's key: the 15 routing modes and
  the models that can be pinned.
- :func:`validate_credentials` checks a key against ``GET /v1/usage`` when it is saved in
  Settings → Model Providers.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

import httpx
from lfx.base.models.model_metadata import create_model_metadata
from lfx.base.models.model_utils import get_provider_variable_value
from lfx.log.logger import logger

from lfx_aistupidlevel import __version__

if TYPE_CHECKING:
    from uuid import UUID

PROVIDER = "AI Stupid Level"
ICON = "Gauge"
API_KEY_VARIABLE = "AISTUPIDLEVEL_API_KEY"
DEFAULT_BASE_URL = "https://aistupidlevel.info/v1"
KEYS_URL = "https://aistupidlevel.info/router/keys"

# The routing modes, in the order the model picker lists them. ``auto-coding`` comes first, so it is
# the default; the first five are enabled without a visit to Settings → Model Providers.
ROUTING_MODES = (
    "auto-coding",
    "auto-tooling",
    "auto-reasoning",
    "auto-best",
    "auto-value",
    "auto",
    "auto-value-coding",
    "auto-value-reasoning",
    "auto-value-tooling",
    "auto-fastest-quality",
    "auto-cheapest",
    "auto-fastest",
    "auto-consistent",
    "auto-task",
    "auto-split",
)
DEFAULT_MODEL = ROUTING_MODES[0]
DEFAULT_MODES = frozenset(ROUTING_MODES[:5])

_TIMEOUT_SECONDS = 5


def base_url() -> str:
    """The router endpoint: ``ASL_BASE_URL`` when set (as for ChatAISL), else the public router."""
    return (os.environ.get("ASL_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _secret(value: Any) -> str:
    if hasattr(value, "get_secret_value"):
        value = value.get_secret_value()
    return value.strip() if isinstance(value, str) else ""


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "User-Agent": f"lfx-aistupidlevel/{__version__}"}


def order_model_ids(entries: Any) -> list[str]:
    """Model ids from a ``/v1/models`` ``data`` list: routing modes first, then pinnable models."""
    if not isinstance(entries, list):
        return []
    rank = {mode: i for i, mode in enumerate(ROUTING_MODES)}
    seen: set[str] = set()
    modes: list[str] = []
    pins: list[str] = []
    for entry in entries:
        model_id = entry.get("id") if isinstance(entry, dict) else None
        if not isinstance(model_id, str) or not model_id.strip() or model_id.strip() in seen:
            continue
        model_id = model_id.strip()
        seen.add(model_id)
        is_mode = entry.get("owned_by") == "aistupidlevel" or model_id == "auto" or model_id.startswith("auto-")
        (modes if is_mode else pins).append(model_id)
    modes.sort(key=lambda mode: rank.get(mode, len(rank)))  # stable: unknown modes keep server order
    return modes + pins


def fetch_model_ids(api_key: str) -> list[str]:
    """Model ids from ``GET /v1/models``, routing modes first. Raises ``httpx.HTTPError`` or ``ValueError``."""
    response = httpx.get(
        f"{base_url()}/models", headers=_headers(api_key), timeout=_TIMEOUT_SECONDS, follow_redirects=False
    )
    response.raise_for_status()
    data = response.json()
    return order_model_ids(data.get("data") if isinstance(data, dict) else None)


def _rows(model_ids: list[str]) -> list[dict]:
    # Every routing mode and pinned model takes tool calls; the router routes text only, so no row
    # claims image input.
    return [
        dict(
            create_model_metadata(
                provider=PROVIDER,
                name=model_id,
                icon=ICON,
                model_type="llm",
                tool_calling=True,
                default=model_id in DEFAULT_MODES,
            )
        )
        for model_id in model_ids
    ]


def load_static_catalog() -> list[dict]:
    """The routing modes, shown before a key is configured and when discovery fails."""
    return _rows(list(ROUTING_MODES))


def fetch_live_models(user_id: UUID | str | None, model_type: str = "llm") -> list[dict]:
    """Routing modes and pinnable models from ``GET /v1/models``.

    Langflow replaces the static rows of a live provider with whatever this returns, so every
    failure returns the static routing modes instead of an empty list. The router has no embedding
    models.
    """
    if model_type != "llm":
        return []
    try:
        api_key = _secret(get_provider_variable_value(user_id, API_KEY_VARIABLE))
    except Exception:  # noqa: BLE001 - a missing variable only means "no live list"
        api_key = ""
    if not api_key:
        return load_static_catalog()
    try:
        model_ids = fetch_model_ids(api_key)
    except Exception:  # noqa: BLE001 - degrade to the static routing modes on any transport or parse error
        logger.debug(f"Could not fetch the {PROVIDER} model list from {base_url()}; using the routing modes")
        return load_static_catalog()
    return _rows(model_ids) if model_ids else load_static_catalog()


def validate_credentials(provider: str, variables: dict[str, Any], model_name: str | None = None) -> None:  # noqa: ARG001
    """Check the key with ``GET /v1/usage``; raise ``ValueError`` with a message for the user if it fails.

    ``provider`` and ``model_name`` are part of Langflow's validator contract and are not needed.
    """
    api_key = _secret(variables.get(API_KEY_VARIABLE))
    if not api_key:
        msg = f"An {PROVIDER} API key is required. Create a router key at {KEYS_URL}."
        raise ValueError(msg)
    url = f"{base_url()}/usage"
    try:
        response = httpx.get(url, headers=_headers(api_key), timeout=_TIMEOUT_SECONDS, follow_redirects=False)
    except httpx.TimeoutException as e:
        msg = f"The connection to {PROVIDER} at {base_url()} timed out."
        raise ValueError(msg) from e
    except httpx.RequestError as e:
        msg = f"Could not connect to {PROVIDER} at {base_url()}: {e}"
        raise ValueError(msg) from e
    if response.status_code in (401, 403):
        msg = f"Invalid {PROVIDER} API key. Create a router key at {KEYS_URL}."
        raise ValueError(msg)
    if response.status_code >= 400:  # noqa: PLR2004
        msg = f"{PROVIDER} returned HTTP {response.status_code} for {url}."
        raise ValueError(msg)
