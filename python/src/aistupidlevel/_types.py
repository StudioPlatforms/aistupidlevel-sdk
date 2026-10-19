"""Response objects and routing information."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional

__all__ = ["ROUTING_MODES", "RoutingInfo", "Obj", "routing_from_headers"]

#: Routing modes. "auto" uses the routing preference saved on your account; any model id pins one model.
ROUTING_MODES = (
    "auto", "auto-best", "auto-coding", "auto-reasoning", "auto-tooling", "auto-agentic",
    "auto-value", "auto-value-coding", "auto-value-reasoning", "auto-value-tooling", "auto-value-agentic",
    "auto-consistent", "auto-fastest-quality", "auto-fastest", "auto-cheapest", "auto-task", "auto-split",
)


class Obj(dict):
    """A JSON object from the API: a plain ``dict`` that also allows attribute access
    (``completion.choices[0].message.content``). ``json.dumps`` sees only the API's fields."""

    def __getattr__(self, name: str) -> Any:
        try:
            return _wrap(self[name])
        except KeyError:
            raise AttributeError(name) from None

    def __getitem__(self, key: Any) -> Any:
        return _wrap(dict.__getitem__(self, key))


def _wrap(v: Any) -> Any:
    if isinstance(v, dict) and not isinstance(v, Obj):
        return Obj(v)
    if isinstance(v, list):
        return [_wrap(x) for x in v]
    return v


@dataclass(frozen=True)
class RoutingInfo:
    """The routing decision behind a response, read from the X-AISM-* headers."""

    #: Provider that answered: openai, anthropic, google, deepseek, kimi or glm.
    provider: Optional[str]
    #: Model that answered.
    model: Optional[str]
    #: Why it was chosen, including any fallback.
    reasoning: Optional[str]
    #: Router-measured time to the answer, in ms (non-streaming).
    latency_ms: Optional[int]
    #: The request id (same as the completion id). Quote it when reporting a problem.
    request_id: Optional[str]
    #: True when the answer is a sandbox mock.
    sandbox: bool
    #: True when the response was replayed for a repeated Idempotency-Key.
    replayed: bool
    #: True when the first choice failed and a fallback answered.
    fallback: bool


def routing_from_headers(headers: Mapping[str, str]) -> RoutingInfo:
    h: Dict[str, str] = {k.lower(): v for k, v in headers.items()}
    reasoning = h.get("x-aism-reasoning")
    latency = h.get("x-aism-latency")
    return RoutingInfo(
        provider=h.get("x-aism-provider"),
        model=h.get("x-aism-model"),
        reasoning=reasoning,
        latency_ms=int(latency) if latency and latency.isdigit() else None,
        request_id=h.get("x-aism-request-id"),
        sandbox=h.get("x-aism-sandbox") == "true",
        replayed=h.get("idempotent-replayed") == "true",
        fallback=bool(reasoning and re.search(r"fallback activated", reasoning, re.I)),
    )
