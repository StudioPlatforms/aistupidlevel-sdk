"""
title: AI Stupid Level
author: AI Stupid Level
author_url: https://aistupidlevel.info
git_url: https://github.com/StudioPlatforms/aistupidlevel-sdk/tree/main/integrations/open-webui
version: 0.1.0
required_open_webui_version: 0.5.17
license: MIT
description: Stop choosing AI models manually. Let live benchmarks choose the best model for coding, reasoning, or agent tasks—using your own provider keys, with zero token markup. Adds each AI Stupid Level Smart Router routing mode as a model, and shows above every reply which model answered and why.
"""

# AI Stupid Level Smart Router for Open WebUI, as a manifold Pipe.
#
# The router (https://aistupidlevel.info/router) is OpenAI-compatible. Each routing mode, such as
# auto-coding, sends a request to the model that currently scores best on AI Stupid Level's
# continuously re-run benchmarks, and calls it with the provider keys saved on the AI Stupid Level
# account. What this function adds over a plain OpenAI connection:
#   - every routing mode is its own model in the selector, with a readable name;
#   - a status line above each reply names the model that answered and why it was chosen
#     (from the X-AISM-Model and X-AISM-Reasoning response headers; click it for the full reason);
#   - one shared key for the instance (Valves), and an optional key per user (UserValves) that
#     overrides it, so each person can use their own account and provider keys;
#   - a plain explanation, instead of an error, when a message contains an image: the router
#     routes text only, and nothing is sent in that case;
#   - a sandbox switch that routes for real but returns mock answers, so a setup can be checked
#     without spending anything.
#
# Network: only the Base URL valve (default https://aistupidlevel.info/v1) is called. Only the
# OpenAI request fields listed in FORWARDED_FIELDS are sent. The router key is never logged or
# shown. Source and issues: https://github.com/StudioPlatforms/aistupidlevel-sdk

import hashlib
import json
import logging
import os
import re
import time
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

VERSION = "0.1.0"
USER_AGENT = f"aistupidlevel-open-webui/{VERSION}"
SITE = "https://aistupidlevel.info"
DEFAULT_BASE_URL = f"{SITE}/v1"
KEYS_URL = f"{SITE}/router/keys"
PROVIDERS_URL = f"{SITE}/router/providers"
PREFERENCES_URL = f"{SITE}/router/preferences"
KEY_ENV = "AISTUPIDLEVEL_API_KEY"

MODEL_LIST_TTL = 300  # seconds a fetched model list is reused
MODEL_LIST_RETRY = 60  # seconds before retrying after the list could not be fetched
CHAT_TIMEOUT = httpx.Timeout(
    900.0, connect=15.0
)  # reasoning models can think for minutes

# The routing modes, in the order of https://aistupidlevel.info/router/docs#strategies, with the
# names shown in the model selector. Modes the router adds later appear under their own id.
ROUTING_MODES = {
    "auto": "Default (your saved strategy)",
    "auto-coding": "Best for coding",
    "auto-reasoning": "Best for reasoning",
    "auto-tooling": "Best for tool use",
    "auto-best": "Best overall",
    "auto-value": "Best value",
    "auto-value-coding": "Best value for coding",
    "auto-value-reasoning": "Best value for reasoning",
    "auto-value-tooling": "Best value for tool use",
    "auto-fastest-quality": "Fastest near the top",
    "auto-cheapest": "Cheapest",
    "auto-fastest": "Fastest",
    "auto-consistent": "Most consistent",
    "auto-task": "Per request",
    "auto-split": "Your split",
}

# The request fields the router reads. Nothing else from Open WebUI's request body is sent.
FORWARDED_FIELDS = (
    "messages",
    "temperature",
    "top_p",
    "max_tokens",
    "max_completion_tokens",
    "stop",
    "seed",
    "frequency_penalty",
    "presence_penalty",
    "reasoning_effort",
    "response_format",
    "tools",
    "tool_choice",
    "functions",
    "function_call",
    "stream_options",
    "n",
)

# Content parts the router refuses (it routes text only), as the router itself lists them.
NON_TEXT_PARTS = {
    "image_url": "an image",
    "input_image": "an image",
    "image": "an image",
    "image_file": "an image",
    "input_audio": "audio",
    "audio": "audio",
    "file": "a file",
    "input_file": "a file",
    "video_url": "a video",
    "input_video": "a video",
}

# Start of the router's strategy description -> (short label, whether it is a ranking on a benchmark).
_STRATEGIES = (
    ("best value overall", "best value overall", False),
    ("best value for coding", "best value for coding", False),
    ("best value for reasoning", "best value for reasoning", False),
    ("best value for tool use", "best value for tool use", False),
    ("best agentic coding", "agentic coding", True),
    ("best coding", "coding", True),
    ("best reasoning", "reasoning", True),
    ("best tool calling", "tool use", True),
    ("best overall", "overall", True),
    ("best general quality", "overall", True),
    ("most cost-effective", "cheapest", False),
    ("fastest response time", "fastest", False),
    ("fastest near-top", "fastest near the top", False),
    ("most consistent near-top", "most consistent near the top", False),
    ("your traffic split", "your traffic split", False),
)


def routing_summary(reasoning: str) -> str:
    """A few words on why the router chose the model, from its X-AISM-Reasoning header."""
    text = re.sub(r"^Sandbox:\s*", "", " ".join((reasoning or "").split()))
    if not text:
        return ""
    if text.startswith("Direct pin"):
        return "pinned"
    notes = []
    main = ""
    fallback = re.match(
        r"Fallback activated: (.+?) failed -> routed to \S+?\.(?:\s|$)", text
    )
    if fallback:
        notes.append(f"fallback after {fallback.group(1)} failed")
        text = text[fallback.end() :]
    declined = re.match(
        r"(\S+) declined this request, and Anthropic's refusal fallback", text
    )
    if declined:
        notes.append(f"fallback after {declined.group(1)} declined")
    task = re.match(r"Matched this request \((.+?)\) to ", text)
    selected = re.search(r"Selected \S+ from \S+ for (.+)", text)
    if selected and not fallback and not declined:
        for start, label, ranked in _STRATEGIES:
            if selected.group(1).startswith(start):
                main = _ranking(label, text) if ranked else label
                break
    if "Continuing the tool-use conversation on" in text:
        main = "continuing the tool calls"
    elif "Continuing the conversation on" in text:
        main = "continuing this conversation"
    if main and task:
        main = f"{task.group(1)}: {main}"
    drift = re.search(r"Passed over for an active drift alert: (.+?)\.(?:\s|$)", text)
    if drift:
        names = re.findall(r"(\S+) \(", drift.group(1)) or [drift.group(1)]
        notes.append(f"skipped {', '.join(names)} (drift alert)")
    if "every available candidate is flagged" in text:
        notes.append("every candidate has a drift alert")
    parts = [p for p in [main, *notes] if p]
    if not parts:
        first = text.split(". ")[0].rstrip(".")
        return first if len(first) <= 80 else first[:79].rstrip() + "…"
    return "; ".join(parts)


def _ranking(label: str, text: str) -> str:
    label = "overall" if label == "overall" else f"on {label}"
    if "Statistically tied" in text:
        how = (
            "cheapest"
            if "chosen as the cheapest" in text
            else "fastest"
            if "chosen as the fastest" in text
            else "highest score"
            if "highest score is used" in text
            else ""
        )
        return f"tied for first {label}" + (f", {how}" if how else "")
    if "Kept from your earlier requests" in text:
        return f"tied for first {label}, kept from earlier requests"
    if "Measurably ahead" in text:
        return f"#1 {label}, measurably ahead"
    return f"#1 {label}"


def status_line(model: str, reasoning: str, sandbox: bool = False) -> str:
    """The status shown above a reply, e.g. 'AI Stupid Level → gpt-5.6-luna (tied for first on coding, cheapest)'."""
    why = routing_summary(reasoning)
    line = f"AI Stupid Level → {model}" + (f" ({why})" if why else "")
    return line + (" · sandbox" if sandbox else "")


def _readable(reasoning: str) -> str:
    """The full reason, with the arrows and ± the header had to spell in ASCII."""
    return " ".join(reasoning.split()).replace(" +/-", " ±").replace(" -> ", " → ")


def _non_text_part(messages: Any) -> tuple | None:
    """(what, in_newest_user_message) for the first attachment the router cannot take, else None."""
    if not isinstance(messages, list):
        return None
    user_turns = [
        i
        for i, m in enumerate(messages)
        if isinstance(m, dict) and m.get("role") == "user"
    ]
    newest = user_turns[-1] if user_turns else -1
    order = ([newest] if newest >= 0 else []) + [
        i for i in range(len(messages)) if i != newest
    ]
    for i in order:
        message = messages[i]
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, list):
            for part in content:
                kind = part.get("type") if isinstance(part, dict) else None
                if kind in NON_TEXT_PARTS:
                    return NON_TEXT_PARTS[kind], i == newest
    return None


def _text_only_reply(what: str, newest: bool) -> str:
    where = (
        f"Your message includes {what}"
        if newest
        else f"An earlier message in this chat includes {what}"
    )
    fix = (
        "Remove it and send the text again, or use a vision model from another connection for this message."
        if newest
        else "Start a new chat without it, or continue this chat with a vision model from another connection."
    )
    return (
        f"{where}, and AI Stupid Level routes text only, so nothing was sent. The router picks a model "
        "from benchmark results for coding, reasoning and tool use, and none of those measure image, "
        f"audio or file understanding. {fix}"
    )


def _redact(text: str, key: str) -> str:
    if key:
        text = text.replace(key, "[router key]")
    return re.sub(r"aism_[A-Za-z0-9_-]{6,}", "aism_…", text)


def _error_text(status: int, raw: bytes, headers: Any, key: str) -> str:
    """A readable error from the router's {"error": {...}} body, with a hint where one helps."""
    try:
        error = json.loads(raw or b"{}").get("error") or {}
    except (ValueError, AttributeError):
        error = {}
    if not isinstance(error, dict):
        error = {"message": str(error)}
    message = str(
        error.get("message") or error.get("detail") or f"HTTP {status}"
    ).strip()
    if message[-1:] not in (".", "!", "?"):
        message += "."
    code = error.get("code")
    hint = ""
    if status == 401 or code == "invalid_api_key":
        hint = " Check the router key (it starts with aism_) in this function's Valves."
        if KEYS_URL not in message:
            hint += f" Keys are created at {KEYS_URL}."
    elif code in (
        "no_provider_keys",
        "provider_key_rejected",
        "provider_quota_exceeded",
    ):
        if PROVIDERS_URL not in message:
            hint = f" Provider keys are managed at {PROVIDERS_URL}."
    elif code == "no_routable_model" and PREFERENCES_URL not in message:
        hint = f" Routing preferences are at {PREFERENCES_URL}."
    request_id = headers.get("x-aism-request-id") if headers is not None else None
    suffix = f" (request {request_id})" if request_id else ""
    return _redact(f"AI Stupid Level: {message}{hint}{suffix}", key)


class RouterError(Exception):
    """An error to show on the message. Open WebUI displays str(error)."""


class _Status:
    """Status events above the reply. A failed emit never affects the answer."""

    def __init__(self, emitter: Any):
        self._emitter = emitter
        self.shown = False  # whether this request has shown a status

    async def show(self, description: str, done: bool) -> None:
        await self._send({"description": description, "done": done, "hidden": False})
        self.shown = self.shown or self._emitter is not None

    async def clear(self) -> None:
        if self.shown:
            await self._send({"description": "", "done": True, "hidden": True})

    async def _send(self, data: dict) -> None:
        if self._emitter is None:
            return
        try:
            await self._emitter({"type": "status", "data": data})
        except Exception as e:  # noqa: BLE001 - the status line is cosmetic
            log.debug("AI Stupid Level: status event failed (%s)", type(e).__name__)


class Pipe:
    class Valves(BaseModel):
        BASE_URL: str = Field(
            default=DEFAULT_BASE_URL,
            description="Smart Router endpoint (OpenAI-compatible).",
        )
        API_KEY: str = Field(
            default="",
            description=(
                f"Router key (aism_...) for everyone without a key of their own. Create one at {KEYS_URL}. "
                f"When empty, the {KEY_ENV} environment variable is used."
            ),
            json_schema_extra={"input": {"type": "password"}},
        )
        NAME_PREFIX: str = Field(
            default="AI Stupid Level: ",
            description="Text before each model name in the model selector.",
        )
        SHOW_PINNED_MODELS: bool = Field(
            default=True,
            description="Also list single models (Claude, GPT, Gemini, DeepSeek, Kimi, GLM) that skip routing.",
        )
        SHOW_STATUS: bool = Field(
            default=True,
            description="Show above each reply which model answered and why.",
        )
        SANDBOX: bool = Field(
            default=False,
            description="Route for real but return mock answers, so nothing is billed. For checking the setup.",
        )

    class UserValves(BaseModel):
        API_KEY: str = Field(
            default="",
            description=(
                "Your own router key (aism_...). Your requests then use your AI Stupid Level account and "
                f"your provider keys. Leave empty to use the shared key. Create one at {KEYS_URL}."
            ),
            json_schema_extra={"input": {"type": "password"}},
        )

    def __init__(self):
        self.valves = self.Valves()
        self._list_scope: tuple | None = None
        self._live_ids: list | None = None
        self._list_until = 0.0
        self._last_line: dict = {}  # message id -> status line shown, so tool rounds do not repeat it

    # Model list

    async def pipes(self) -> list:
        base, key = self._base_url(), self._shared_key()
        scope = (base, hashlib.sha256(key.encode()).hexdigest() if key else "")
        now = time.monotonic()
        if scope != self._list_scope:
            self._list_scope, self._live_ids, self._list_until = scope, None, 0.0
        if key and now >= self._list_until:
            live = await self._fetch_model_ids(base, key)
            if live:
                self._live_ids = live
            self._list_until = now + (MODEL_LIST_TTL if live else MODEL_LIST_RETRY)
        return self._model_entries(self._live_ids)

    async def _fetch_model_ids(self, base: str, key: str) -> list | None:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{base}/models", headers=self._headers(key, stream=False)
                )
            if response.status_code != 200:
                log.warning(
                    "AI Stupid Level: listing models returned HTTP %s",
                    response.status_code,
                )
                return None
            data = response.json().get("data") or []
        except (httpx.HTTPError, ValueError, AttributeError) as e:
            log.warning("AI Stupid Level: listing models failed (%s)", type(e).__name__)
            return None
        seen, out = set(), []
        for item in data:
            model_id = item.get("id") if isinstance(item, dict) else None
            if isinstance(model_id, str) and model_id and model_id not in seen:
                seen.add(model_id)
                out.append((model_id, item.get("owned_by")))
        return out

    def _model_entries(self, live: list | None) -> list:
        prefix = self.valves.NAME_PREFIX
        if not live:
            # No list from the router (no shared key, or it could not be reached): the routing modes,
            # which every router key can use.
            modes, pinned = list(ROUTING_MODES), []
        else:
            is_mode = {
                m: owner == "aistupidlevel" or m == "auto" or m.startswith("auto-")
                for m, owner in live
            }
            listed = [m for m, _ in live if is_mode[m]]
            modes = [m for m in ROUTING_MODES if m in listed] + [
                m for m in listed if m not in ROUTING_MODES
            ]
            pinned = (
                sorted(m for m, _ in live if not is_mode[m])
                if self.valves.SHOW_PINNED_MODELS
                else []
            )
        return [
            {"id": m, "name": f"{prefix}{ROUTING_MODES.get(m, m)}"} for m in modes
        ] + [{"id": m, "name": f"{prefix}{m} (pinned)"} for m in pinned]

    # Chat

    async def pipe(
        self,
        body: dict,
        __user__: dict | None = None,
        __event_emitter__: Any = None,
        __task__: str | None = None,
        __message_id__: str | None = None,
    ):
        # Open WebUI sends "<function id>.<router model>"; router model ids may contain dots.
        model = str(body.get("model") or "")
        head, dot, rest = model.partition(".")
        if dot and head.isidentifier():
            model = rest
        messages = body.get("messages")

        # Text only: explain instead of sending a request the router would refuse.
        problem = _non_text_part(messages)
        if problem:
            return _text_only_reply(*problem)

        key = self._user_key(__user__) or self._shared_key()
        if not key:
            raise RouterError(
                "AI Stupid Level: no router key is set. An admin can add one in Admin Panel > Functions > "
                "AI Stupid Level > Valves, or you can add your own with the Valves button next to the "
                f"message box. Create a key at {KEYS_URL}."
            )

        stream = bool(body.get("stream"))
        payload = {k: body[k] for k in FORWARDED_FIELDS if body.get(k) is not None}
        payload["model"] = model
        payload["stream"] = stream
        if stream:  # token counts for Open WebUI's usage display
            payload["stream_options"] = {
                **(payload.get("stream_options") or {}),
                "include_usage": True,
            }

        # Background tasks (titles, tags, follow-ups) run silently. A tool round (the newest message is
        # a tool result) adds a line to the reply's status history only when the routing changed.
        status = _Status(
            __event_emitter__ if self.valves.SHOW_STATUS and not __task__ else None
        )
        tool_round = (
            isinstance(messages, list)
            and bool(messages)
            and isinstance(messages[-1], dict)
            and (messages[-1].get("role") == "tool")
        )
        if not tool_round:
            await status.show(f"AI Stupid Level: routing with {model}…", done=False)

        base = self._base_url()
        client = httpx.AsyncClient(timeout=CHAT_TIMEOUT)
        try:
            request = client.build_request(
                "POST",
                f"{base}/chat/completions",
                json=payload,
                headers=self._headers(key, stream),
            )
            response = await client.send(request, stream=True)
        except httpx.HTTPError as e:
            await client.aclose()
            await status.clear()
            raise RouterError(
                f"AI Stupid Level could not be reached at {base} ({type(e).__name__})."
            ) from None
        except BaseException:
            await client.aclose()
            raise

        try:
            if response.status_code != 200:
                raw = await response.aread()
                await status.clear()
                raise RouterError(
                    _error_text(response.status_code, raw, response.headers, key)
                )

            routed = response.headers.get("x-aism-model")
            if routed:
                reasoning = response.headers.get("x-aism-reasoning") or ""
                sandbox = response.headers.get("x-aism-sandbox") == "true"
                line = status_line(routed, reasoning, sandbox)
                if not tool_round:
                    if reasoning:
                        await status.show(_readable(reasoning), done=True)
                    await status.show(line, done=True)
                elif self._last_line.get(__message_id__) != line:
                    await status.show(line, done=True)
                if __message_id__ and status.shown:
                    self._last_line.pop(__message_id__, None)
                    self._last_line[__message_id__] = line
                    while len(self._last_line) > 512:
                        self._last_line.pop(next(iter(self._last_line)))
            else:
                await status.clear()

            if stream:
                relay = self._relay(client, response)
                client = response = None  # the relay closes them
                return relay
            try:
                data = json.loads(await response.aread())
            except ValueError:
                raise RouterError(
                    "AI Stupid Level returned a response that is not JSON."
                ) from None
            return _visible_refusal(data)
        finally:
            if response is not None:
                await response.aclose()
            if client is not None:
                await client.aclose()

    async def _relay(
        self, client: httpx.AsyncClient, response: httpx.Response
    ) -> AsyncIterator[dict]:
        """The router's stream as chunks for Open WebUI, which adds its own closing chunk and [DONE]."""
        answered = False
        try:
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                choices = chunk.get("choices") if isinstance(chunk, dict) else None
                delta = (
                    choices[0].get("delta")
                    if choices and isinstance(choices[0], dict)
                    else None
                )
                if isinstance(delta, dict):
                    refusal = delta.get("refusal")
                    if delta.get("content"):
                        answered = True
                    elif isinstance(refusal, str) and refusal:
                        # Open WebUI shows content only: show a decline as text.
                        delta["content"] = ("\n\n" if answered else "") + refusal
                yield chunk
        except httpx.HTTPError as e:
            yield {
                "error": {
                    "message": f"AI Stupid Level: the answer stopped before it finished ({type(e).__name__})."
                }
            }
        finally:
            await response.aclose()
            await client.aclose()

    # Helpers

    def _base_url(self) -> str:
        url = (self.valves.BASE_URL or DEFAULT_BASE_URL).strip().rstrip("/")
        if urlparse(url).path in ("", "/"):
            url += "/v1"
        return url

    def _shared_key(self) -> str:
        return (self.valves.API_KEY or os.environ.get(KEY_ENV, "")).strip()

    @staticmethod
    def _user_key(user: dict | None) -> str:
        valves = (user or {}).get("valves")
        key = (
            valves.get("API_KEY")
            if isinstance(valves, dict)
            else getattr(valves, "API_KEY", "")
        )
        return (key or "").strip()

    def _headers(self, key: str, stream: bool) -> dict:
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if stream else "application/json",
            "User-Agent": USER_AGENT,
            "X-ASL-Client": USER_AGENT,
        }
        if self.valves.SANDBOX:
            headers["X-ASL-Sandbox"] = "true"
        return headers


def _visible_refusal(data: Any) -> Any:
    """A declined request has its text in message.refusal; Open WebUI shows message.content."""
    try:
        message = data["choices"][0]["message"]
        if (
            not message.get("content")
            and isinstance(message.get("refusal"), str)
            and message["refusal"]
        ):
            message["content"] = message["refusal"]
    except (KeyError, IndexError, TypeError, AttributeError):
        pass
    return data
