"""Retry policy, request building and server-sent-event parsing shared by both clients."""
from __future__ import annotations

import email.utils
import json
import os
import random
import time
import uuid
from typing import Any, Dict, Iterator, List, Optional

from ._errors import ASLError, StreamInterruptedError
from ._version import __version__

DEFAULT_BASE_URL = "https://aistupidlevel.info/v1"
#: Reasoning models can think for minutes; the router itself allows 15.
DEFAULT_TIMEOUT = 600.0
DEFAULT_MAX_RETRIES = 2

_INITIAL_RETRY_DELAY = 0.5
_MAX_RETRY_DELAY = 8.0
_MAX_RETRY_AFTER = 60.0


def env_key() -> Optional[str]:
    return os.environ.get("ASL_ROUTER_KEY") or os.environ.get("ASL_API_KEY") or None


def env_base_url() -> Optional[str]:
    return os.environ.get("ASL_BASE_URL") or None


def missing_key_error() -> ASLError:
    return ASLError("Missing router key: pass api_key= or set ASL_ROUTER_KEY. "
                    "Create a key at https://aistupidlevel.info/router/keys")


def retry_after_seconds(headers: Dict[str, str]) -> Optional[float]:
    ms = headers.get("retry-after-ms")
    if ms:
        try:
            return min(float(ms) / 1000, _MAX_RETRY_AFTER)
        except ValueError:
            pass
    ra = headers.get("retry-after")
    if not ra:
        return None
    try:
        return min(float(ra), _MAX_RETRY_AFTER)
    except ValueError:
        parsed = email.utils.parsedate_to_datetime(ra) if ra else None
        if parsed is None:
            return None
        return min(max(0.0, parsed.timestamp() - time.time()), _MAX_RETRY_AFTER)


def backoff_seconds(attempt: int) -> float:
    """0.5 s, 1 s, 2 s … capped at 8 s, each reduced by up to 25%."""
    base = min(_INITIAL_RETRY_DELAY * (2 ** attempt), _MAX_RETRY_DELAY)
    return base * (1 - random.random() * 0.25)


def should_retry(status: int, headers: Dict[str, str]) -> bool:
    """The server's x-should-retry wins; otherwise 408, 409, 429 and 5xx are retried."""
    hint = headers.get("x-should-retry")
    if hint == "true":
        return True
    if hint == "false":
        return False
    return status in (408, 409, 429) or status >= 500


def new_idempotency_key() -> str:
    return f"asl-{uuid.uuid4()}"


def build_headers(
    *,
    api_key: Optional[str],
    default_headers: Dict[str, str],
    stream: bool,
    has_body: bool,
    sandbox: bool,
    simulate: Optional[str],
    idempotency_key: Optional[str],
    extra_headers: Optional[Dict[str, str]],
) -> Dict[str, str]:
    h = {
        "Accept": "text/event-stream" if stream else "application/json",
        "User-Agent": f"aistupidlevel-python/{__version__}",
        "X-ASL-Client": f"aistupidlevel-python/{__version__}",
        **default_headers,
    }
    if api_key:
        h["Authorization"] = f"Bearer {api_key}"
    if has_body:
        h["Content-Type"] = "application/json"
    if sandbox:
        h["X-ASL-Sandbox"] = "true"
    if simulate:
        h["X-ASL-Sandbox-Simulate"] = simulate
    # The same key on every attempt: a retry of a request whose answer was lost is never charged twice.
    if idempotency_key:
        h["Idempotency-Key"] = idempotency_key
    if extra_headers:
        h.update(extra_headers)
    return h


def lower_headers(headers: Any) -> Dict[str, str]:
    return {k.lower(): v for k, v in headers.items()}


def parse_json(text: str) -> Any:
    return json.loads(text) if text else None


def events_from_lines(lines: Iterator[str], request_id: Optional[str]) -> Iterator[Dict[str, Any]]:
    """Server-sent events: yields each ``data:`` JSON object until ``[DONE]``. A chunk carrying
    ``error`` (the stream stopped mid-answer) raises StreamInterruptedError; so does a stream that
    ends without ``[DONE]``."""
    data: List[str] = []
    for line in lines:
        if line == "":
            if not data:
                continue
            payload = "\n".join(data)
            data = []
            if payload == "[DONE]":
                return
            event = _decode(payload, request_id)
            if event is not None:
                yield event
            continue
        if line.startswith("data:"):
            data.append(line[5:][1:] if line[5:].startswith(" ") else line[5:])
    if data:
        payload = "\n".join(data)
        if payload == "[DONE]":
            return
        event = _decode(payload, request_id)
        if event is not None:
            yield event
    raise StreamInterruptedError("The stream ended before it was complete", request_id=request_id)


def _decode(payload: str, request_id: Optional[str]) -> Optional[Dict[str, Any]]:
    try:
        obj = json.loads(payload)
    except ValueError:
        return None
    if isinstance(obj, dict) and obj.get("error"):
        e = obj["error"] if isinstance(obj["error"], dict) else {}
        raise StreamInterruptedError(e.get("message") or "The stream stopped before the answer finished",
                                     code=e.get("code") or "stream_interrupted", type=e.get("type"),
                                     request_id=request_id, body=obj)
    return obj


def assemble(chunks: List[Dict[str, Any]], routing_model: Optional[str] = None) -> Dict[str, Any]:
    """The chat.completion a sequence of chunks adds up to (content, tool calls, usage)."""
    content = ""
    finish = "stop"
    usage = None
    calls: Dict[int, Dict[str, Any]] = {}
    first = chunks[0] if chunks else {}
    for c in chunks:
        if c.get("usage"):
            usage = c["usage"]
        choices = c.get("choices") or []
        if not choices:
            continue
        ch = choices[0]
        delta = ch.get("delta") or {}
        if delta.get("content"):
            content += delta["content"]
        for tc in delta.get("tool_calls") or []:
            i = tc.get("index", 0)
            prev = calls.get(i, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
            fn = tc.get("function") or {}
            calls[i] = {
                "id": tc.get("id") or prev["id"],
                "type": "function",
                "function": {
                    "name": fn.get("name") or prev["function"]["name"],
                    "arguments": prev["function"]["arguments"] + (fn.get("arguments") or ""),
                },
            }
        if ch.get("finish_reason"):
            finish = ch["finish_reason"]
    tool_calls = [calls[i] for i in sorted(calls)]
    message: Dict[str, Any] = {"role": "assistant", "content": content or (None if tool_calls else "")}
    if tool_calls:
        message["tool_calls"] = tool_calls
    out: Dict[str, Any] = {
        "id": first.get("id", ""),
        "object": "chat.completion",
        "created": first.get("created", int(time.time())),
        "model": first.get("model") or routing_model or "",
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
    }
    if first.get("system_fingerprint"):
        out["system_fingerprint"] = first["system_fingerprint"]
    if usage:
        out["usage"] = usage
    return out
