"""Live tests against the real router, in sandbox mode (nothing is spent or counted).
Run with: ASL_ROUTER_KEY=aism_... python -m unittest tests.test_live   (skipped without a key)"""
import asyncio
import os
import time
import unittest

from aistupidlevel import (
    AllowanceExhaustedError, ASLRouter, AsyncASLRouter, BudgetExceededError, ModelUnavailableError,
    ProviderKeyError, RateLimitError,
)

KEY = os.environ.get("ASL_ROUTER_KEY")
MSG = [{"role": "user", "content": "Write a function that reverses a string."}]
TOOLS = [{"type": "function", "function": {"name": "get_weather", "parameters": {
    "type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}]


@unittest.skipUnless(KEY, "set ASL_ROUTER_KEY to run the live sandbox tests")
class LiveSandbox(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.router = ASLRouter(KEY, sandbox=True, max_retries=1)

    @classmethod
    def tearDownClass(cls):
        cls.router.close()

    def test_completion(self):
        r = self.router.chat.completions.create(model="auto-coding", messages=MSG)
        self.assertEqual(r.object, "chat.completion")
        self.assertTrue(r.routing.sandbox)
        self.assertTrue(r.routing.model and r.routing.provider and r.routing.reasoning)
        self.assertEqual(r.model, r.routing.model)
        self.assertTrue(r.choices[0].message.content.startswith("Sandbox response"))

    def test_preview_agrees(self):
        p = self.router.route.preview(model="auto-coding", messages=MSG)
        r = self.router.chat.completions.create(model="auto-coding", messages=MSG)
        self.assertEqual(p.primary.model, r.routing.model)
        self.assertEqual(p.strategy, "best_coding")

    def test_stream(self):
        with self.router.chat.completions.create(model="auto-best", messages=MSG, stream=True,
                                                 stream_options={"include_usage": True}) as s:
            self.assertTrue(s.routing.sandbox)
            final = s.final_completion()
        self.assertTrue(final.choices[0].message.content.startswith("Sandbox response"))
        self.assertGreater(final.usage.total_tokens, 0)

    def test_run_tools_one_model(self):
        seen = []
        out = self.router.chat.run_tools(
            model="auto-tooling", messages=[{"role": "user", "content": "Weather in Oslo?"}], tools=TOOLS,
            handlers={"get_weather": lambda city: {"city": city, "temp": 7}},
            on_round=lambda i, c, calls: seen.append(c.routing.model))
        self.assertEqual(out["rounds"], 2)
        self.assertEqual(seen[0], seen[1])
        self.assertIn("temp", out["completion"].choices[0].message.content)

    def test_idempotent_replay(self):
        k = f"sdk-py-live-{time.time_ns()}"
        a = self.router.chat.completions.create(model="auto", messages=MSG, idempotency_key=k)
        b = self.router.chat.completions.create(model="auto", messages=MSG, idempotency_key=k)
        self.assertEqual(a.id, b.id)
        self.assertTrue(b.routing.replayed)

    def test_simulated_errors(self):
        for simulate, cls in [("allowance_exhausted", AllowanceExhaustedError), ("insufficient_quota", BudgetExceededError),
                              ("provider_key_rejected", ProviderKeyError), ("model_unavailable", ModelUnavailableError),
                              ("rate_limited", RateLimitError)]:
            with self.subTest(simulate):
                with self.assertRaises(cls):
                    self.router.chat.completions.create(model="auto", messages=MSG, simulate=simulate, max_retries=0)

    def test_fallback_visible(self):
        r = self.router.chat.completions.create(model="auto-best", messages=MSG, simulate="fallback")
        self.assertTrue(r.routing.fallback)

    def test_usage_and_models(self):
        u = self.router.usage()
        self.assertEqual(u.object, "usage")
        self.assertIsInstance(u.requests.used, int)
        self.assertTrue(any(m.id == "auto-coding" for m in self.router.models.list().data))

    def test_async(self):
        async def go():
            async with AsyncASLRouter(KEY, sandbox=True) as c:
                r = await c.chat.completions.create(model="auto-reasoning", messages=MSG)
                s = await c.chat.completions.create(model="auto-reasoning", messages=MSG, stream=True)
                text = "".join([t async for t in s.text_stream()])
                return r, text
        r, text = asyncio.run(go())
        self.assertTrue(r.routing.sandbox)
        self.assertTrue(text.startswith("Sandbox response"))


if __name__ == "__main__":
    unittest.main()
