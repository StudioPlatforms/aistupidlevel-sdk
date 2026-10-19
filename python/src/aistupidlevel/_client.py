"""ASLRouter (sync) and AsyncASLRouter (asyncio)."""
from __future__ import annotations

import asyncio
import inspect
import json
import time
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, Iterator, List, Mapping, Optional, Tuple, Union

import httpx

from ._core import (
    DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT, _decode, assemble, backoff_seconds, build_headers,
    env_base_url, env_key, events_from_lines, lower_headers, missing_key_error, new_idempotency_key, parse_json,
    retry_after_seconds, should_retry,
)
from ._errors import ASLError, ConnectionError, StreamInterruptedError, TimeoutError, error_for
from ._types import Obj, RoutingInfo, routing_from_headers

__all__ = ["ASLRouter", "AsyncASLRouter", "ChatStream", "AsyncChatStream"]

ToolHandler = Callable[..., Any]


def _with_routing(data: Any, headers: Mapping[str, str]) -> Obj:
    obj = Obj(data if isinstance(data, dict) else {"data": data})
    # An attribute, not a key: json.dumps(completion) stays exactly the OpenAI shape.
    object.__setattr__(obj, "routing", routing_from_headers(headers))
    return obj


def _timeout(seconds: float) -> httpx.Timeout:
    return httpx.Timeout(seconds, connect=min(seconds, 30.0))


def _tool_args(call: Mapping[str, Any]) -> Any:
    """A tool call's arguments: parsed JSON, or the raw string if they are not JSON."""
    raw = (call.get("function") or {}).get("arguments") or ""
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return raw


def _encode_result(result: Any) -> str:
    return result if isinstance(result, str) else json.dumps(result)


# ---------------------------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------------------------

class ChatStream:
    """A streamed chat completion. Iterate for chunks, ``text_stream()`` for text, or
    ``final_completion()`` for the assembled answer (tool calls included). ``routing`` is known as
    soon as the stream opens. Use as a context manager, or call ``close()``, to release the connection."""

    def __init__(self, response: httpx.Response, routing: RoutingInfo) -> None:
        self.routing = routing
        self._response = response
        self._consumed = False
        self._chunks: List[Dict[str, Any]] = []
        self._final: Optional[Obj] = None

    def __iter__(self) -> Iterator[Obj]:
        if self._consumed:
            raise RuntimeError("This stream has already been consumed.")
        self._consumed = True
        try:
            for event in events_from_lines(self._lines(), self.routing.request_id):
                self._chunks.append(event)
                yield Obj(event)
        finally:
            self.close()

    def _lines(self) -> Iterator[str]:
        try:
            yield from self._response.iter_lines()
        except httpx.HTTPError as e:
            raise StreamInterruptedError(f"The connection closed during the stream: {e}", request_id=self.routing.request_id) from e

    def text_stream(self) -> Iterator[str]:
        for chunk in self:
            choices = chunk.get("choices") or []
            text = (choices[0].get("delta") or {}).get("content") if choices else None
            if text:
                yield text

    def final_completion(self) -> Obj:
        if self._final is None:
            if not self._consumed:
                for _ in self:
                    pass
            self._final = Obj(assemble(self._chunks, self.routing.model))
            object.__setattr__(self._final, "routing", self.routing)
        return self._final

    def close(self) -> None:
        self._response.close()

    def __enter__(self) -> "ChatStream":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


class _Completions:
    def __init__(self, client: "ASLRouter") -> None:
        self._c = client

    def create(
        self,
        *,
        model: str,
        messages: List[Dict[str, Any]],
        stream: bool = False,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        idempotency_key: Optional[str] = None,
        sandbox: Optional[bool] = None,
        simulate: Optional[str] = None,
        **params: Any,
    ) -> Union[Obj, ChatStream]:
        """Create a routed chat completion (OpenAI Chat Completions parameters). With
        ``stream=True`` returns a ChatStream; otherwise the completion, with ``.routing``."""
        body = {"model": model, "messages": messages, **params}
        opts = dict(timeout=timeout, max_retries=max_retries, extra_headers=extra_headers, sandbox=sandbox, simulate=simulate)
        if stream:
            body["stream"] = True
            response, headers = self._c._request("POST", "/chat/completions", body, stream=True, **opts)
            return ChatStream(response, routing_from_headers(headers))
        key = idempotency_key or (new_idempotency_key() if self._c.auto_idempotency else None)
        data, headers = self._c._request("POST", "/chat/completions", body, idempotency_key=key, **opts)
        return _with_routing(data, headers)


class _Chat:
    def __init__(self, client: "ASLRouter") -> None:
        self.completions = _Completions(client)

    def run_tools(
        self,
        *,
        handlers: Mapping[str, ToolHandler],
        max_rounds: int = 10,
        on_round: Optional[Callable[[int, Obj, List[Obj]], None]] = None,
        **create_kwargs: Any,
    ) -> Dict[str, Any]:
        """Run a tool-calling loop to its final answer. Handlers receive the parsed arguments as
        keyword arguments (or one positional string if they are not a JSON object) and return
        anything JSON-able; an exception is reported to the model, not raised. A forced
        ``tool_choice`` applies to the first turn only. Returns ``{"completion", "messages",
        "rounds", "routing"}``."""
        messages: List[Dict[str, Any]] = list(create_kwargs.pop("messages"))
        tool_choice = create_kwargs.pop("tool_choice", None)
        create_kwargs.pop("stream", None)
        for index in range(max_rounds):
            kwargs = dict(create_kwargs)
            if tool_choice is not None:
                kwargs["tool_choice"] = tool_choice
            completion = self.completions.create(messages=messages, **kwargs)
            message = completion.choices[0].message if completion.get("choices") else Obj({})
            tool_calls = message.get("tool_calls") or []
            if on_round:
                on_round(index, completion, [Obj(c) for c in tool_calls])
            if not tool_calls:
                messages.append({"role": "assistant", "content": message.get("content") or ""})
                return {"completion": completion, "messages": messages, "rounds": index + 1, "routing": completion.routing}
            messages.append({"role": "assistant", "content": message.get("content"), "tool_calls": [dict(c) for c in tool_calls]})
            for call in tool_calls:
                name = (call.get("function") or {}).get("name")
                handler = handlers.get(name)
                if handler is None:
                    content = json.dumps({"error": f'No handler for the tool "{name}".'})
                else:
                    args = _tool_args(call)
                    try:
                        result = handler(**args) if isinstance(args, dict) else handler(args)
                        content = _encode_result(result)
                    except Exception as e:  # the model sees the failure and can recover
                        content = json.dumps({"error": str(e)})
                messages.append({"role": "tool", "tool_call_id": call.get("id"), "content": content})
            if tool_choice not in (None, "auto", "none"):
                tool_choice = "auto"
        raise ASLError(f"The tool loop reached {max_rounds} rounds without a final answer.", code="max_rounds")


class _Route:
    def __init__(self, client: "ASLRouter") -> None:
        self._c = client

    def preview(self, *, model: str = "auto", sandbox: Optional[bool] = None, **params: Any) -> Obj:
        """The routing decision a chat request would get (strategy, model, fallbacks, reasons),
        without sending it. Nothing is called or counted."""
        data, _ = self._c._request("POST", "/route/preview", {"model": model, **params}, sandbox=sandbox)
        return Obj(data)


class _Models:
    def __init__(self, client: "ASLRouter") -> None:
        self._c = client

    def list(self) -> Obj:
        data, _ = self._c._request("GET", "/models")
        return Obj(data)


class _Embeddings:
    def __init__(self, client: "ASLRouter") -> None:
        self._c = client

    def create(self, *, input: Union[str, List[str]], model: str = "text-embedding-3-small", **params: Any) -> Obj:
        data, _ = self._c._request("POST", "/embeddings", {"model": model, "input": input, **params})
        return Obj(data)


class ASLRouter:
    """Client for the AI Stupid Level Smart Router.

    >>> router = ASLRouter()  # reads ASL_ROUTER_KEY
    >>> r = router.chat.completions.create(model="auto-coding", messages=[{"role": "user", "content": "Fix this bug..."}])
    >>> r.choices[0].message.content, r.routing.model, r.routing.reasoning
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        sandbox: bool = False,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Optional[Dict[str, str]] = None,
        auto_idempotency: bool = True,
        http_client: Optional[httpx.Client] = None,
    ) -> None:
        self.api_key = api_key or env_key()
        if not self.api_key:
            raise missing_key_error()
        self.base_url = base_url or env_base_url() or DEFAULT_BASE_URL
        self.sandbox = sandbox
        self.timeout = timeout
        self.max_retries = max_retries
        self.default_headers = dict(default_headers or {})
        self.auto_idempotency = auto_idempotency
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client()
        self.chat = _Chat(self)
        self.route = _Route(self)
        self.models = _Models(self)
        self.embeddings = _Embeddings(self)

    def with_options(self, **overrides: Any) -> "ASLRouter":
        """A copy with some options changed, e.g. ``router.with_options(sandbox=True)``."""
        kwargs = dict(api_key=self.api_key, base_url=self.base_url, sandbox=self.sandbox, timeout=self.timeout,
                      max_retries=self.max_retries, default_headers=self.default_headers,
                      auto_idempotency=self.auto_idempotency, http_client=self._http)
        kwargs.update(overrides)
        return ASLRouter(**kwargs)

    def feedback(self, completion_id: str, rating: Union[str, int]) -> Obj:
        """Rate an answer ("up"/"down" or 1/-1) by its completion id. Ratings nudge future routing."""
        data, _ = self._request("POST", "/router/feedback", {"id": completion_id, "rating": rating})
        return Obj(data)

    def usage(self) -> Obj:
        """This month's allowance, prepaid credits and this key's budget."""
        data, _ = self._request("GET", "/usage")
        return Obj(data)

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> "ASLRouter":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def _request(self, method: str, path: str, body: Any = None, *, stream: bool = False,
                 timeout: Optional[float] = None, max_retries: Optional[int] = None,
                 extra_headers: Optional[Dict[str, str]] = None, idempotency_key: Optional[str] = None,
                 sandbox: Optional[bool] = None, simulate: Optional[str] = None) -> Tuple[Any, Dict[str, str]]:
        url = self.base_url.rstrip("/") + path
        headers = build_headers(api_key=self.api_key, default_headers=self.default_headers, stream=stream,
                                has_body=body is not None, sandbox=self.sandbox if sandbox is None else sandbox,
                                simulate=simulate, idempotency_key=idempotency_key, extra_headers=extra_headers)
        retries = self.max_retries if max_retries is None else max_retries
        seconds = self.timeout if timeout is None else timeout
        content = json.dumps(body) if body is not None else None
        attempt = 0
        while True:
            err: ASLError
            try:
                req = self._http.build_request(method, url, headers=headers, content=content, timeout=_timeout(seconds))
                resp = self._http.send(req, stream=True)
            except httpx.TimeoutException as e:
                err = TimeoutError(f"No response within {seconds} s")
                err.__cause__ = e
            except httpx.TransportError as e:
                err = ConnectionError(f"Connection failed: {e}")
                err.__cause__ = e
            else:
                h = lower_headers(resp.headers)
                if resp.status_code < 400:
                    if stream:
                        return resp, h
                    try:
                        text = resp.read().decode("utf-8")
                    except httpx.HTTPError as e:
                        resp.close()
                        err = ConnectionError(f"The connection closed while reading the response: {e}")
                    else:
                        resp.close()
                        try:
                            return parse_json(text), h
                        except ValueError:
                            raise ASLError("The router returned a response that is not JSON",
                                           status=resp.status_code, body=text[:500], headers=h) from None
                else:
                    try:
                        resp.read()
                        payload = parse_json(resp.text)
                    except (ValueError, httpx.HTTPError):
                        payload = None
                    finally:
                        resp.close()
                    wait = retry_after_seconds(h)
                    err = error_for(resp.status_code, payload, h, wait)
                    if attempt < retries and should_retry(resp.status_code, h):
                        time.sleep(wait if wait is not None else backoff_seconds(attempt))
                        attempt += 1
                        continue
                    raise err
            if attempt < retries:
                time.sleep(backoff_seconds(attempt))
                attempt += 1
                continue
            raise err


# ---------------------------------------------------------------------------------------------
# Async
# ---------------------------------------------------------------------------------------------

class AsyncChatStream:
    """Async counterpart of ChatStream: ``async for chunk in stream``, ``text_stream()``,
    ``await final_completion()``, ``await close()`` / ``async with``."""

    def __init__(self, response: httpx.Response, routing: RoutingInfo) -> None:
        self.routing = routing
        self._response = response
        self._consumed = False
        self._chunks: List[Dict[str, Any]] = []
        self._final: Optional[Obj] = None

    async def __aiter__(self) -> AsyncIterator[Obj]:
        if self._consumed:
            raise RuntimeError("This stream has already been consumed.")
        self._consumed = True
        data: List[str] = []
        try:
            try:
                async for line in self._response.aiter_lines():
                    if line == "":
                        if not data:
                            continue
                        payload = "\n".join(data)
                        data = []
                        if payload == "[DONE]":
                            return
                        event = _decode(payload, self.routing.request_id)
                        if event is not None:
                            self._chunks.append(event)
                            yield Obj(event)
                    elif line.startswith("data:"):
                        data.append(line[6:] if line.startswith("data: ") else line[5:])
            except httpx.HTTPError as e:
                raise StreamInterruptedError(f"The connection closed during the stream: {e}", request_id=self.routing.request_id) from e
            if data and "\n".join(data) == "[DONE]":
                return
            raise StreamInterruptedError("The stream ended before it was complete", request_id=self.routing.request_id)
        finally:
            await self.close()

    async def text_stream(self) -> AsyncIterator[str]:
        async for chunk in self:
            choices = chunk.get("choices") or []
            text = (choices[0].get("delta") or {}).get("content") if choices else None
            if text:
                yield text

    async def final_completion(self) -> Obj:
        if self._final is None:
            if not self._consumed:
                async for _ in self:
                    pass
            self._final = Obj(assemble(self._chunks, self.routing.model))
            object.__setattr__(self._final, "routing", self.routing)
        return self._final

    async def close(self) -> None:
        await self._response.aclose()

    async def __aenter__(self) -> "AsyncChatStream":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()


class _AsyncCompletions:
    def __init__(self, client: "AsyncASLRouter") -> None:
        self._c = client

    async def create(
        self,
        *,
        model: str,
        messages: List[Dict[str, Any]],
        stream: bool = False,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        idempotency_key: Optional[str] = None,
        sandbox: Optional[bool] = None,
        simulate: Optional[str] = None,
        **params: Any,
    ) -> Union[Obj, AsyncChatStream]:
        body = {"model": model, "messages": messages, **params}
        opts = dict(timeout=timeout, max_retries=max_retries, extra_headers=extra_headers, sandbox=sandbox, simulate=simulate)
        if stream:
            body["stream"] = True
            response, headers = await self._c._request("POST", "/chat/completions", body, stream=True, **opts)
            return AsyncChatStream(response, routing_from_headers(headers))
        key = idempotency_key or (new_idempotency_key() if self._c.auto_idempotency else None)
        data, headers = await self._c._request("POST", "/chat/completions", body, idempotency_key=key, **opts)
        return _with_routing(data, headers)


class _AsyncChat:
    def __init__(self, client: "AsyncASLRouter") -> None:
        self.completions = _AsyncCompletions(client)

    async def run_tools(
        self,
        *,
        handlers: Mapping[str, ToolHandler],
        max_rounds: int = 10,
        on_round: Optional[Callable[[int, Obj, List[Obj]], Any]] = None,
        **create_kwargs: Any,
    ) -> Dict[str, Any]:
        """Async run_tools; handlers may be plain functions or coroutines."""
        messages: List[Dict[str, Any]] = list(create_kwargs.pop("messages"))
        tool_choice = create_kwargs.pop("tool_choice", None)
        create_kwargs.pop("stream", None)
        for index in range(max_rounds):
            kwargs = dict(create_kwargs)
            if tool_choice is not None:
                kwargs["tool_choice"] = tool_choice
            completion = await self.completions.create(messages=messages, **kwargs)
            message = completion.choices[0].message if completion.get("choices") else Obj({})
            tool_calls = message.get("tool_calls") or []
            if on_round:
                r = on_round(index, completion, [Obj(c) for c in tool_calls])
                if inspect.isawaitable(r):
                    await r
            if not tool_calls:
                messages.append({"role": "assistant", "content": message.get("content") or ""})
                return {"completion": completion, "messages": messages, "rounds": index + 1, "routing": completion.routing}
            messages.append({"role": "assistant", "content": message.get("content"), "tool_calls": [dict(c) for c in tool_calls]})
            for call in tool_calls:
                name = (call.get("function") or {}).get("name")
                handler = handlers.get(name)
                if handler is None:
                    content = json.dumps({"error": f'No handler for the tool "{name}".'})
                else:
                    args = _tool_args(call)
                    try:
                        result = handler(**args) if isinstance(args, dict) else handler(args)
                        if inspect.isawaitable(result):
                            result = await result
                        content = _encode_result(result)
                    except Exception as e:
                        content = json.dumps({"error": str(e)})
                messages.append({"role": "tool", "tool_call_id": call.get("id"), "content": content})
            if tool_choice not in (None, "auto", "none"):
                tool_choice = "auto"
        raise ASLError(f"The tool loop reached {max_rounds} rounds without a final answer.", code="max_rounds")


class _AsyncRoute:
    def __init__(self, client: "AsyncASLRouter") -> None:
        self._c = client

    async def preview(self, *, model: str = "auto", sandbox: Optional[bool] = None, **params: Any) -> Obj:
        data, _ = await self._c._request("POST", "/route/preview", {"model": model, **params}, sandbox=sandbox)
        return Obj(data)


class _AsyncModels:
    def __init__(self, client: "AsyncASLRouter") -> None:
        self._c = client

    async def list(self) -> Obj:
        data, _ = await self._c._request("GET", "/models")
        return Obj(data)


class _AsyncEmbeddings:
    def __init__(self, client: "AsyncASLRouter") -> None:
        self._c = client

    async def create(self, *, input: Union[str, List[str]], model: str = "text-embedding-3-small", **params: Any) -> Obj:
        data, _ = await self._c._request("POST", "/embeddings", {"model": model, "input": input, **params})
        return Obj(data)


class AsyncASLRouter:
    """Asyncio client: the same API as ASLRouter, with ``await``."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        sandbox: bool = False,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Optional[Dict[str, str]] = None,
        auto_idempotency: bool = True,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.api_key = api_key or env_key()
        if not self.api_key:
            raise missing_key_error()
        self.base_url = base_url or env_base_url() or DEFAULT_BASE_URL
        self.sandbox = sandbox
        self.timeout = timeout
        self.max_retries = max_retries
        self.default_headers = dict(default_headers or {})
        self.auto_idempotency = auto_idempotency
        self._owns_http = http_client is None
        self._http = http_client or httpx.AsyncClient()
        self.chat = _AsyncChat(self)
        self.route = _AsyncRoute(self)
        self.models = _AsyncModels(self)
        self.embeddings = _AsyncEmbeddings(self)

    def with_options(self, **overrides: Any) -> "AsyncASLRouter":
        kwargs = dict(api_key=self.api_key, base_url=self.base_url, sandbox=self.sandbox, timeout=self.timeout,
                      max_retries=self.max_retries, default_headers=self.default_headers,
                      auto_idempotency=self.auto_idempotency, http_client=self._http)
        kwargs.update(overrides)
        return AsyncASLRouter(**kwargs)

    async def feedback(self, completion_id: str, rating: Union[str, int]) -> Obj:
        data, _ = await self._request("POST", "/router/feedback", {"id": completion_id, "rating": rating})
        return Obj(data)

    async def usage(self) -> Obj:
        data, _ = await self._request("GET", "/usage")
        return Obj(data)

    async def close(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def __aenter__(self) -> "AsyncASLRouter":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    async def _request(self, method: str, path: str, body: Any = None, *, stream: bool = False,
                       timeout: Optional[float] = None, max_retries: Optional[int] = None,
                       extra_headers: Optional[Dict[str, str]] = None, idempotency_key: Optional[str] = None,
                       sandbox: Optional[bool] = None, simulate: Optional[str] = None) -> Tuple[Any, Dict[str, str]]:
        url = self.base_url.rstrip("/") + path
        headers = build_headers(api_key=self.api_key, default_headers=self.default_headers, stream=stream,
                                has_body=body is not None, sandbox=self.sandbox if sandbox is None else sandbox,
                                simulate=simulate, idempotency_key=idempotency_key, extra_headers=extra_headers)
        retries = self.max_retries if max_retries is None else max_retries
        seconds = self.timeout if timeout is None else timeout
        content = json.dumps(body) if body is not None else None
        attempt = 0
        while True:
            err: ASLError
            try:
                req = self._http.build_request(method, url, headers=headers, content=content, timeout=_timeout(seconds))
                resp = await self._http.send(req, stream=True)
            except httpx.TimeoutException as e:
                err = TimeoutError(f"No response within {seconds} s")
                err.__cause__ = e
            except httpx.TransportError as e:
                err = ConnectionError(f"Connection failed: {e}")
                err.__cause__ = e
            else:
                h = lower_headers(resp.headers)
                if resp.status_code < 400:
                    if stream:
                        return resp, h
                    try:
                        text = (await resp.aread()).decode("utf-8")
                    except httpx.HTTPError as e:
                        await resp.aclose()
                        err = ConnectionError(f"The connection closed while reading the response: {e}")
                    else:
                        await resp.aclose()
                        try:
                            return parse_json(text), h
                        except ValueError:
                            raise ASLError("The router returned a response that is not JSON",
                                           status=resp.status_code, body=text[:500], headers=h) from None
                else:
                    try:
                        await resp.aread()
                        payload = parse_json(resp.text)
                    except (ValueError, httpx.HTTPError):
                        payload = None
                    finally:
                        await resp.aclose()
                    wait = retry_after_seconds(h)
                    err = error_for(resp.status_code, payload, h, wait)
                    if attempt < retries and should_retry(resp.status_code, h):
                        await asyncio.sleep(wait if wait is not None else backoff_seconds(attempt))
                        attempt += 1
                        continue
                    raise err
            if attempt < retries:
                await asyncio.sleep(backoff_seconds(attempt))
                attempt += 1
                continue
            raise err
