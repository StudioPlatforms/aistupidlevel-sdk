import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type KeyValueStore, loadWithCache } from "../src/lib/cache";
import { PRICING_URL } from "../src/lib/constants";
import {
  DataApiError,
  type DataApiResult,
  type DriftSignature,
  type HistoryPoint,
  type Incident,
  type ModelScore,
  dataApiGet,
  historyPath,
  modelsPath,
} from "../src/lib/data-api";
import {
  axisBar,
  driftMarkdown,
  formatDuration,
  historyMarkdown,
  incidentTitle,
  newestAxes,
  providerLabel,
  quotaText,
  rankLabel,
  rankModels,
  relativeTime,
  sortIncidents,
  sparkline,
  summarizeHistory,
} from "../src/lib/format";

// Real /api/v1 responses captured on 2026-10-20 (free key).
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8"));
const models = fixture<{ data: ModelScore[] }>("models");
const history = fixture<{ data: HistoryPoint[] }>("history");
const incidents = fixture<{ data: Incident[] }>("incidents");
const drift = fixture<{ data: DriftSignature }>("drift");
const latestRefused = fixture<Record<string, unknown>>("latest_refused");
const quotaExceeded = fixture<Record<string, unknown>>("quota_exceeded");

const NOW = Date.parse("2026-10-20T07:00:00Z");

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// ── Data API client ─────────────────────────────────────────────────────────

test("dataApiGet unwraps the envelope and reads the quota headers", async () => {
  const { impl, calls } = fakeFetch(200, models, {
    "x-ratelimit-limit": "10",
    "x-ratelimit-remaining": "8",
    "x-ratelimit-reset": "1792540800",
  });
  const r = await dataApiGet<ModelScore[]>(modelsPath("combined", "24h"), " asl_live_test ", { fetchImpl: impl });
  assert.equal(r.data.length, 24);
  assert.deepEqual(r.rate, { limit: 10, remaining: 8, resetAt: 1792540800 });
  assert.equal(calls[0].url, "https://aistupidlevel.info/api/v1/models?period=24h&sortBy=combined");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer asl_live_test");
  assert.equal(quotaText(r.rate), "8 of 10 API requests left today");
});

test("no key: a clear error and no request", async () => {
  const { impl, calls } = fakeFetch(200, models);
  await assert.rejects(dataApiGet("/models", "  ", { fetchImpl: impl }), (e: unknown) => {
    assert.ok(e instanceof DataApiError);
    assert.equal(e.kind, "missing_key");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("free key asking for the latest run gets plan_required with the pricing link", async () => {
  const { impl } = fakeFetch(403, latestRefused);
  await assert.rejects(
    dataApiGet(modelsPath("combined", "latest"), "asl_live_x", { fetchImpl: impl }),
    (e: unknown) => {
      assert.ok(e instanceof DataApiError);
      assert.equal(e.kind, "plan_required");
      assert.equal(e.helpUrl, PRICING_URL);
      assert.equal(e.canUseStale, false);
      return true;
    },
  );
});

test("daily quota 429 and per-minute 429 are told apart", async () => {
  // The daily-quota body is a real 429 (captured 2026-10-20); the per-minute one is the rate
  // limiter's error builder in the API source, with its Retry-After header.
  const daily = fakeFetch(429, quotaExceeded, { "x-ratelimit-limit": "10", "x-ratelimit-remaining": "0" });
  await assert.rejects(dataApiGet("/models", "asl_live_x", { fetchImpl: daily.impl }), (e: unknown) => {
    assert.ok(e instanceof DataApiError);
    assert.equal(e.kind, "quota_exceeded");
    assert.match(e.message, /resets at 00:00 UTC/);
    assert.equal(e.helpUrl, PRICING_URL);
    assert.equal(e.canUseStale, true);
    return true;
  });

  const minute = fakeFetch(
    429,
    {
      statusCode: 429,
      error: "Too Many Requests",
      message: "You are making requests too quickly. Please wait 42s and try again.",
    },
    { "retry-after": "42" },
  );
  await assert.rejects(dataApiGet("/models", "asl_live_x", { fetchImpl: minute.impl }), (e: unknown) => {
    assert.ok(e instanceof DataApiError);
    assert.equal(e.kind, "rate_limited");
    assert.equal(e.retryAfterSec, 42);
    assert.match(e.message, /42 s/);
    return true;
  });
});

test("401, outage, network failure and a non-envelope answer", async () => {
  const cases: Array<[ReturnType<typeof fakeFetch>, string]> = [
    [fakeFetch(401, { error: "invalid_api_key", message: "That API key is not valid" }), "invalid_key"],
    [fakeFetch(502, "<html>Bad gateway</html>"), "server"],
    [fakeFetch(200, { hello: "world" }), "server"],
  ];
  for (const [f, kind] of cases) {
    await assert.rejects(dataApiGet("/models", "asl_live_x", { fetchImpl: f.impl }), (e: unknown) => {
      assert.ok(e instanceof DataApiError);
      assert.equal(e.kind, kind);
      return true;
    });
  }
  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(dataApiGet("/models", "asl_live_x", { fetchImpl: offline }), (e: unknown) => {
    assert.ok(e instanceof DataApiError);
    assert.equal(e.kind, "network");
    return true;
  });
});

test("paths are encoded", () => {
  assert.equal(historyPath("gpt-6.1-sol", "7d"), "/models/gpt-6.1-sol/history?period=7d");
  assert.equal(modelsPath("7axis", "1m"), "/models?period=1m&sortBy=7axis");
});

// ── Cache ───────────────────────────────────────────────────────────────────

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: (k) => map.get(k), set: (k, v) => void map.set(k, v) };
}

const ok = (data: unknown): DataApiResult<unknown> => ({
  data,
  rate: { limit: 10, remaining: 5, resetAt: null },
  generatedAt: null,
});

test("cache: one request, then served from the cache for 15 minutes", async () => {
  const store = memoryStore();
  let calls = 0;
  let now = NOW;
  const load = (force = false) =>
    loadWithCache({
      store,
      key: "k",
      ttlMs: 15 * 60_000,
      now: () => now,
      force,
      fetcher: async () => (calls++, ok(calls)),
    });

  const first = await load();
  assert.equal(first.fromCache, false);
  assert.equal(first.data, 1);

  now += 14 * 60_000;
  const second = await load();
  assert.equal(second.fromCache, true);
  assert.equal(second.data, 1);
  assert.equal(calls, 1);

  const forced = await load(true);
  assert.equal(forced.data, 2);

  now += 16 * 60_000;
  const third = await load();
  assert.equal(third.data, 3);
  assert.equal(calls, 3);
});

test("cache: a refused refresh falls back to the stored answer, with the error attached", async () => {
  const store = memoryStore();
  let now = NOW;
  await loadWithCache({ store, key: "k", ttlMs: 1000, now: () => now, fetcher: async () => ok("old") });
  now += 5000;
  const quota = new DataApiError("quota_exceeded", "used up");
  const r = await loadWithCache({
    store,
    key: "k",
    ttlMs: 1000,
    now: () => now,
    fetcher: async () => {
      throw quota;
    },
  });
  assert.equal(r.data, "old");
  assert.equal(r.fromCache, true);
  assert.equal(r.error, quota);

  // A key problem is not hidden behind old data.
  await assert.rejects(
    loadWithCache({
      store,
      key: "k",
      ttlMs: 1000,
      now: () => now,
      fetcher: async () => {
        throw new DataApiError("invalid_key", "revoked");
      },
    }),
    /revoked/,
  );
  // Nothing stored: the error surfaces.
  await assert.rejects(
    loadWithCache({
      store: memoryStore(),
      key: "k",
      ttlMs: 1000,
      fetcher: async () => {
        throw quota;
      },
    }),
    /used up/,
  );
});

test("cache: a corrupt entry is ignored", async () => {
  const store = memoryStore();
  store.set("k", "{not json");
  const r = await loadWithCache({ store, key: "k", ttlMs: 1000, fetcher: async () => ok("fresh") });
  assert.equal(r.data, "fresh");
});

// ── Leaderboard formatting ──────────────────────────────────────────────────

test("ranks follow the API order; equal published scores share a rank", () => {
  const ranked = rankModels(models.data);
  assert.equal(ranked.length, 24);
  assert.deepEqual(ranked.map(rankLabel), [
    "=1",
    "=1",
    "=3",
    "=3",
    "=3",
    "=6",
    "=6",
    "8",
    "9",
    "=10",
    "=10",
    "=12",
    "=12",
    "=12",
    "=12",
    "=12",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
    "23",
    "24",
  ]);
  assert.equal(ranked[0].model.displayName, "Claude Opus 5.5");
});

test("unranked and unavailable rows keep their place without a rank", () => {
  const rows: ModelScore[] = [
    { ...models.data[0] },
    { ...models.data[1], rankable: false },
    { ...models.data[2], currentScore: "unavailable" },
    { ...models.data[3] },
  ];
  const ranked = rankModels(rows);
  assert.deepEqual(
    ranked.map((r) => r.rank),
    [1, null, null, 2],
  );
  assert.equal(rankLabel(ranked[1]), "–");
});

test("provider labels", () => {
  assert.equal(providerLabel("openai"), "OpenAI");
  assert.equal(providerLabel("glm"), "Z.ai");
  assert.equal(providerLabel("kimi"), "Moonshot AI");
  assert.equal(providerLabel("newco"), "Newco");
  assert.equal(providerLabel(null), "Unknown");
});

test("relative time and durations", () => {
  assert.equal(relativeTime("2026-10-20T06:59:30Z", NOW), "just now");
  assert.equal(relativeTime("2026-10-20T06:35:00Z", NOW), "25 min ago");
  assert.equal(relativeTime("2026-10-19T07:00:00Z", NOW), "24 h ago");
  assert.equal(relativeTime("2026-10-15T07:00:00Z", NOW), "5 d ago");
  assert.equal(relativeTime("garbage", NOW), "unknown");
  assert.equal(formatDuration("2026-10-14T10:00:53.848Z", "2026-10-17T16:43:03.859Z"), "3 d 6 h");
});

// ── History ─────────────────────────────────────────────────────────────────

test("history summary and sparkline from a real response", () => {
  const s = summarizeHistory(history.data);
  assert.equal(s.count, 6);
  assert.deepEqual(s.series, [100, 99, 98, 98, 94, 99]);
  assert.equal(s.newest, 99);
  assert.equal(s.min, 94);
  assert.equal(s.max, 100);
  assert.equal(s.mean, 98);
  assert.equal(sparkline(s.series), "█▇▆▆▁▇");
  assert.equal(sparkline([5, 5, 5]), "▄▄▄");
  assert.equal(sparkline([]), "");
});

test("axes of the newest run, in a fixed order", () => {
  const axes = newestAxes(history.data);
  assert.ok(axes);
  assert.equal(axes.timestamp, "2026-10-20T06:00:00.239Z");
  assert.deepEqual(
    axes.axes.map(([k]) => k),
    ["correctness", "spec", "codeQuality", "efficiency", "stability", "refusal", "recovery"],
  );
  assert.equal(axisBar(0.970712660975714), "██████████ 97%");
  assert.equal(axisBar(0.5), "█████░░░░░ 50%");
  assert.equal(axisBar(1.7), "██████████ 100%");
});

test("history markdown says only what the data says", () => {
  const md = historyMarkdown("Claude Opus 5.5", history.data, "Last 24 Hours", NOW);
  assert.match(md, /^# Claude Opus 5\.5/);
  assert.match(md, /6 runs/);
  assert.match(md, /█▇▆▆▁▇ {3}100 → 99/);
  assert.match(md, /Spec Compliance {2}██████████ 99%/);
  assert.match(md, /\| 2026-10-20 06:00 UTC \| 99 \|/);
  assert.match(historyMarkdown("X", [], "Last 7 Days"), /No scored runs/);
});

// ── Incidents and drift ─────────────────────────────────────────────────────

test("incidents: titles in plain words, active before resolved", () => {
  const [openai, anthropic] = incidents.data;
  assert.equal(incidentTitle(openai), "OpenAI: 5 of 8 models degraded");
  assert.equal(incidentTitle(anthropic), "Anthropic: 8 of 9 models degraded");

  const active: Incident = { ...openai, id: 1, resolvedAt: null, detectedAt: "2026-10-20T05:00:00Z" };
  const sorted = sortIncidents([...incidents.data, active]);
  assert.deepEqual(
    sorted.active.map((i) => i.id),
    [1],
  );
  assert.equal(sorted.resolved.length, 2);

  const disruption: Incident = {
    ...openai,
    incidentType: "service_disruption",
    title: "Service Disruption - gpt-6-sol",
    metadata: null,
  };
  assert.equal(incidentTitle(disruption), "Service Disruption - gpt-6-sol");
});

test("drift markdown from a real signature", () => {
  const md = driftMarkdown("Claude Opus 5.5", drift.data, NOW);
  assert.match(md, /\*\*Drift status: Normal\*\*/);
  assert.match(md, /\| Coding \| ok \| 0\.000 \| 0\.30 \| 28 \|/);
  assert.match(md, /\| Tool Use \| ok \| 0\.005 \| 0\.50 for 3 days \| 26 \|/);
  assert.match(md, /\| Reasoning \| ok \| 0\.000 \| 0\.30 \| 26 \|/);
  assert.match(md, /2026-10-14 10:00 UTC/);

  const warming = driftMarkdown("X", {
    ...drift.data,
    pageHinkleyBySuite: { hourly: { cusum: 0.2, days: 4, armed: false, threshold: 0.3, coldStart: 10 } },
  });
  assert.match(warming, /\| Coding \| warming up \| 0\.200 \| 0\.30 \| 4 of 10 \|/);

  assert.match(driftMarkdown("X", { ...drift.data, dataSource: "synthetic" }), /No measured drift signature/);
});
