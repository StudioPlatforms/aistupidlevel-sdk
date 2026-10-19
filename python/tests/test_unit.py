"""Offline tests: every request goes to an httpx.MockTransport."""
import asyncio
import json
import unittest
from unittest import mock

import httpx

import aistupidlevel
from aistupidlevel import (
    AllowanceExhaustedError, ASLRouter, AsyncASLRouter, AuthenticationError, BudgetExceededError,
    ConnectionError, ModelUnavailableError, ProviderKeyError, StreamInterruptedError,
)

ROUTING = {
    "x-aism-provider": "anthropic", "x-aism-model": "claude-opus-5-5",
    "x-aism-reasoning": "Best coding score", "x-aism-latency": "812", "x-aism-request-id": "chatcmpl-1",
}


def completion(content="hi", tool_calls=None):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {"id": "chatcmpl-1", "object": "chat.completion", "created": 1, "model": "claude-opus-5-5",
            "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if tool_calls else "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}}


def sse(*events, done=True):
    body = "".join(f"data: {json.dumps(e)}\n\n" for e in events)
    return body + ("data: [DONE]\n\n" if done else "")


def chunk(delta, finish=None):
    return {"id": "chatcmpl-1", "object": "chat.completion.chunk", "created": 1, "model": "claude-opus-5-5",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}


class Recorder:
    """A transport answering from a list of handlers, one per request, recording each request."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        r = self.responses.pop(0)
        return r(request) if callable(r) else r


def router(rec, **kw):
    return ASLRouter("aism_test", http_client=httpx.Client(transport=httpx.MockTransport(rec)), **kw)


def arouter(rec, **kw):
    return AsyncASLRouter("aism_test", http_client=httpx.AsyncClient(transport=httpx.MockTransport(rec)), **kw)


def ok(body, headers=ROUTING):
    return httpx.Response(200, json=body, headers=headers)


def err(status, code, headers=None, message="nope"):
    return httpx.Response(status, json={"error": {"message": message, "code": code, "type": "x"}}, headers=headers or {})


class SyncTests(unittest.TestCase):
    def setUp(self):
        p = mock.patch("aistupidlevel._client.time.sleep", lambda s: None)
        p.start()
        self.addCleanup(p.stop)

    def test_completion_routing_and_shape(self):
        rec = Recorder(ok(completion()))
        r = router(rec).chat.completions.create(model="auto-coding", messages=[{"role": "user", "content": "x"}])
        self.assertEqual(r.choices[0].message.content, "hi")
        self.assertEqual(r.routing.model, "claude-opus-5-5")
        self.assertEqual(r.routing.provider, "anthropic")
        self.assertEqual(r.routing.latency_ms, 812)
        self.assertFalse(r.routing.fallback)
        self.assertNotIn("routing", json.loads(json.dumps(r)))
        req = rec.requests[0]
        self.assertEqual(req.headers["authorization"], "Bearer aism_test")
        self.assertTrue(req.headers["idempotency-key"].startswith("asl-"))
        self.assertTrue(req.headers["x-asl-client"].startswith("aistupidlevel-python/"))
        self.assertNotIn("x-asl-sandbox", req.headers)
        self.assertEqual(json.loads(req.content)["model"], "auto-coding")

    def test_retry_keeps_idempotency_key(self):
        rec = Recorder(err(503, "server_error"), httpx.Response(502, text="bad gateway"), ok(completion()))
        r = router(rec).chat.completions.create(model="auto", messages=[])
        self.assertEqual(r.choices[0].message.content, "hi")
        keys = {q.headers["idempotency-key"] for q in rec.requests}
        self.assertEqual(len(rec.requests), 3)
        self.assertEqual(len(keys), 1)

    def test_gives_up_after_max_retries(self):
        rec = Recorder(*[err(502, "model_unavailable")] * 3)
        with self.assertRaises(ModelUnavailableError) as cm:
            router(rec).chat.completions.create(model="auto", messages=[])
        self.assertEqual(len(rec.requests), 3)
        self.assertTrue(cm.exception.retryable)
        self.assertEqual(cm.exception.party, "provider")

    def test_should_retry_false_wins(self):
        rec = Recorder(err(429, "allowance_exhausted", {"x-should-retry": "false"}))
        with self.assertRaises(AllowanceExhaustedError) as cm:
            router(rec).chat.completions.create(model="auto", messages=[])
        self.assertEqual(len(rec.requests), 1)
        self.assertEqual(cm.exception.party, "account")

    def test_error_classes(self):
        for status, code, cls in [(401, None, AuthenticationError), (400, "no_provider_keys", ProviderKeyError),
                                  (429, "insufficient_quota", BudgetExceededError)]:
            rec = Recorder(err(status, code, {"x-should-retry": "false"}))
            with self.assertRaises(cls):
                router(rec, max_retries=0).chat.completions.create(model="auto", messages=[])

    def test_retry_after_honoured(self):
        waits = []
        with mock.patch("aistupidlevel._client.time.sleep", waits.append):
            rec = Recorder(err(429, "rate_limited", {"retry-after-ms": "1500"}), ok(completion()))
            router(rec).chat.completions.create(model="auto", messages=[])
        self.assertEqual(waits, [1.5])

    def test_connection_error_retried(self):
        def boom(request):
            raise httpx.ConnectError("refused", request=request)
        rec = Recorder(boom, ok(completion()))
        r = router(rec).chat.completions.create(model="auto", messages=[])
        self.assertEqual(r.id, "chatcmpl-1")
        rec = Recorder(boom, boom)
        with self.assertRaises(ConnectionError) as cm:
            router(rec, max_retries=1).chat.completions.create(model="auto", messages=[])
        self.assertEqual(cm.exception.party, "network")

    def test_sandbox_and_options(self):
        rec = Recorder(ok(completion()), ok(completion()), ok(completion()))
        c = router(rec, sandbox=True)
        c.chat.completions.create(model="auto", messages=[], simulate="fallback")
        c.with_options(sandbox=False).chat.completions.create(model="auto", messages=[], idempotency_key="mine")
        router(rec, auto_idempotency=False).chat.completions.create(model="auto", messages=[], extra_headers={"X-Extra": "1"})
        a, b, d = rec.requests
        self.assertEqual(a.headers["x-asl-sandbox"], "true")
        self.assertEqual(a.headers["x-asl-sandbox-simulate"], "fallback")
        self.assertNotIn("x-asl-sandbox", b.headers)
        self.assertEqual(b.headers["idempotency-key"], "mine")
        self.assertNotIn("idempotency-key", d.headers)
        self.assertEqual(d.headers["x-extra"], "1")

    def test_stream_text_and_final(self):
        body = sse(chunk({"role": "assistant", "content": "Hel"}), chunk({"content": "lo"}), chunk({}, "stop"),
                   {"id": "chatcmpl-1", "choices": [], "usage": {"total_tokens": 9}})
        rec = Recorder(httpx.Response(200, text=body, headers={**ROUTING, "content-type": "text/event-stream"}))
        s = router(rec).chat.completions.create(model="auto", messages=[], stream=True)
        self.assertEqual(s.routing.model, "claude-opus-5-5")
        self.assertEqual("".join(s.text_stream()), "Hello")
        final = s.final_completion()
        self.assertEqual(final.choices[0].message.content, "Hello")
        self.assertEqual(final.usage.total_tokens, 9)
        self.assertEqual(rec.requests[0].headers["accept"], "text/event-stream")
        self.assertNotIn("idempotency-key", rec.requests[0].headers)

    def test_stream_tool_calls_assembled(self):
        body = sse(
            chunk({"tool_calls": [{"index": 0, "id": "call_1", "type": "function", "function": {"name": "get", "arguments": '{"ci'}}]}),
            chunk({"tool_calls": [{"index": 0, "function": {"arguments": 'ty":"Oslo"}'}}]}),
            chunk({}, "tool_calls"))
        rec = Recorder(httpx.Response(200, text=body, headers=ROUTING))
        with router(rec).chat.completions.create(model="auto", messages=[], stream=True) as s:
            final = s.final_completion()
        call = final.choices[0].message.tool_calls[0]
        self.assertEqual(call.function.name, "get")
        self.assertEqual(json.loads(call.function.arguments), {"city": "Oslo"})
        self.assertEqual(final.choices[0].finish_reason, "tool_calls")

    def test_stream_interrupted(self):
        rec = Recorder(httpx.Response(200, text=sse(chunk({"content": "a"}), done=False), headers=ROUTING))
        s = router(rec).chat.completions.create(model="auto", messages=[], stream=True)
        with self.assertRaises(StreamInterruptedError):
            list(s)
        rec = Recorder(httpx.Response(200, text=sse(chunk({"content": "a"}), {"error": {"message": "cut", "code": "upstream"}}),
                                      headers=ROUTING))
        s = router(rec).chat.completions.create(model="auto", messages=[], stream=True)
        with self.assertRaises(StreamInterruptedError) as cm:
            list(s)
        self.assertEqual(cm.exception.code, "upstream")
        self.assertEqual(cm.exception.request_id, "chatcmpl-1")

    def test_stream_error_before_first_byte_raises_typed(self):
        rec = Recorder(err(400, "no_provider_keys"))
        with self.assertRaises(ProviderKeyError):
            router(rec).chat.completions.create(model="auto", messages=[], stream=True)

    def test_run_tools(self):
        call = {"id": "call_1", "type": "function", "function": {"name": "add", "arguments": '{"a":2,"b":3}'}}
        bad = {"id": "call_2", "type": "function", "function": {"name": "boom", "arguments": "{}"}}
        rec = Recorder(ok(completion(None, [call, bad])), ok(completion("5")))
        rounds = []

        def boom():
            raise ValueError("broken tool")

        out = router(rec).chat.run_tools(
            model="auto-tooling", messages=[{"role": "user", "content": "2+3?"}], tools=[{"type": "function"}],
            tool_choice="required", handlers={"add": lambda a, b: a + b, "boom": boom},
            on_round=lambda i, c, calls: rounds.append((i, len(calls))))
        self.assertEqual(out["completion"].choices[0].message.content, "5")
        self.assertEqual(out["rounds"], 2)
        self.assertEqual(rounds, [(0, 2), (1, 0)])
        self.assertEqual(out["routing"].model, "claude-opus-5-5")
        first, second = (json.loads(r.content) for r in rec.requests)
        self.assertEqual(first["tool_choice"], "required")
        self.assertEqual(second["tool_choice"], "auto")
        tool_msgs = [m for m in second["messages"] if m["role"] == "tool"]
        self.assertEqual(tool_msgs[0], {"role": "tool", "tool_call_id": "call_1", "content": "5"})
        self.assertIn("broken tool", tool_msgs[1]["content"])

    def test_run_tools_max_rounds(self):
        call = {"id": "c", "type": "function", "function": {"name": "f", "arguments": "{}"}}
        rec = Recorder(ok(completion(None, [call])), ok(completion(None, [call])))
        with self.assertRaises(aistupidlevel.ASLError) as cm:
            router(rec).chat.run_tools(model="auto", messages=[], handlers={"f": lambda: 1}, max_rounds=2)
        self.assertEqual(cm.exception.code, "max_rounds")

    def test_preview_usage_feedback(self):
        rec = Recorder(ok({"object": "route.preview", "primary": {"model": "gpt-6"}}),
                       ok({"object": "usage", "requests": {"used": 3}}), ok({"ok": True}))
        c = router(rec)
        self.assertEqual(c.route.preview(model="auto-coding", messages=[]).primary.model, "gpt-6")
        self.assertEqual(c.usage().requests.used, 3)
        c.feedback("chatcmpl-1", "up")
        self.assertEqual([r.url.path for r in rec.requests], ["/v1/route/preview", "/v1/usage", "/v1/router/feedback"])
        self.assertEqual(rec.requests[1].method, "GET")

    def test_missing_key(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(aistupidlevel.ASLError):
                ASLRouter()
        with mock.patch.dict("os.environ", {"ASL_ROUTER_KEY": "aism_env", "ASL_BASE_URL": "http://x/v1"}):
            c = ASLRouter()
            self.assertEqual((c.api_key, c.base_url), ("aism_env", "http://x/v1"))


class AsyncTests(unittest.TestCase):
    def setUp(self):
        async def nap(s):
            return None
        p = mock.patch("aistupidlevel._client.asyncio.sleep", nap)
        p.start()
        self.addCleanup(p.stop)

    def run_async(self, coro):
        return asyncio.run(coro)

    def test_completion_and_retry(self):
        async def go():
            rec = Recorder(err(503, "server_error"), ok(completion()))
            async with arouter(rec) as c:
                r = await c.chat.completions.create(model="auto", messages=[])
            return r, rec
        r, rec = self.run_async(go())
        self.assertEqual(r.routing.model, "claude-opus-5-5")
        self.assertEqual(len({q.headers["idempotency-key"] for q in rec.requests}), 1)

    def test_stream(self):
        async def go():
            rec = Recorder(httpx.Response(200, text=sse(chunk({"content": "a"}), chunk({"content": "b"}), chunk({}, "stop")), headers=ROUTING))
            c = arouter(rec)
            s = await c.chat.completions.create(model="auto", messages=[], stream=True)
            text = [t async for t in s.text_stream()]
            final = await s.final_completion()
            rec2 = Recorder(httpx.Response(200, text=sse(chunk({"content": "a"}), done=False), headers=ROUTING))
            s2 = await arouter(rec2).chat.completions.create(model="auto", messages=[], stream=True)
            with self.assertRaises(StreamInterruptedError):
                async for _ in s2:
                    pass
            return text, final
        text, final = self.run_async(go())
        self.assertEqual(text, ["a", "b"])
        self.assertEqual(final.choices[0].message.content, "ab")

    def test_run_tools_async_handler(self):
        call = {"id": "c1", "type": "function", "function": {"name": "look", "arguments": '{"q":"x"}'}}

        async def look(q):
            return {"found": q}

        async def go():
            rec = Recorder(ok(completion(None, [call])), ok(completion("done")))
            out = await arouter(rec).chat.run_tools(model="auto", messages=[], handlers={"look": look})
            return out, rec
        out, rec = self.run_async(go())
        self.assertEqual(out["completion"].choices[0].message.content, "done")
        tool = [m for m in json.loads(rec.requests[1].content)["messages"] if m["role"] == "tool"][0]
        self.assertEqual(json.loads(tool["content"]), {"found": "x"})

    def test_errors(self):
        async def go():
            rec = Recorder(err(429, "allowance_exhausted", {"x-should-retry": "false"}))
            await arouter(rec).chat.completions.create(model="auto", messages=[])
        with self.assertRaises(AllowanceExhaustedError):
            self.run_async(go())


if __name__ == "__main__":
    unittest.main()
