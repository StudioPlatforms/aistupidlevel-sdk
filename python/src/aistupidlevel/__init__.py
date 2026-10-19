"""Client for the AI Stupid Level Smart Router.

One OpenAI-compatible endpoint that routes every request to the model measuring best for it, on
continuously re-run benchmarks, with your own provider keys.

    from aistupidlevel import ASLRouter

    router = ASLRouter()  # reads ASL_ROUTER_KEY
    r = router.chat.completions.create(model="auto-coding", messages=[{"role": "user", "content": "Fix this bug..."}])
    print(r.choices[0].message.content, r.routing.model, r.routing.reasoning)
"""
from ._client import ASLRouter, AsyncASLRouter, AsyncChatStream, ChatStream
from ._core import DEFAULT_BASE_URL
from ._errors import *  # noqa: F401,F403
from ._errors import __all__ as _errors_all
from ._types import ROUTING_MODES, Obj, RoutingInfo, routing_from_headers
from ._version import __version__

__all__ = [
    "ASLRouter", "AsyncASLRouter", "ChatStream", "AsyncChatStream", "RoutingInfo", "Obj", "ROUTING_MODES",
    "routing_from_headers", "DEFAULT_BASE_URL", "__version__", *_errors_all,
]
