/**
 * The MCP server: tools over the ASL Data API (rankings, history, drift, incidents, providers,
 * recommendations) and the ASL Smart Router (route preview, routed prompts, usage).
 *
 * Every Data API tool makes at most one request, and usually none: answers are cached, and model
 * names are resolved from the cached leaderboard. Tools that need a key that is not configured
 * answer with a tool error saying which key and where to get it.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LINKS, VERSION, resolveConfig, type ServerOptions } from './config.js';
import { DataApi, type DataResult } from './data-api.js';
import { RouterApi, ROUTING_MODES } from './router-api.js';
import { ToolError } from './errors.js';
import { ago, footer, modelLabel, num, pct, truncate, usd, when } from './format.js';

const SUITE_LABEL: Record<string, string> = { hourly: 'coding', deep: 'reasoning', tooling: 'tool use', canary: 'canary' };
const suiteName = (s: string) => SUITE_LABEL[s] ?? s;
const PERIOD_LABEL: Record<string, string> = { '24h': '24-hour', '7d': '7-day', '1m': '30-day', latest: 'newest-run' };
const AXIS_LABEL: Record<string, string> = { codeQuality: 'code quality', spec: 'spec compliance' };
const axisName = (a: string) => AXIS_LABEL[a] ?? a.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const PERIOD = z.enum(['24h', '7d', '1m', 'latest']);
const PERIOD_HELP =
  'Score window: 24h, 7d or 1m (30-day) averages, or latest (the newest run). Omit it to use the key\'s default: ' +
  '24h on a free Data API key, latest on a paid one. latest needs a paid key.';
const MODEL_HELP =
  'The model: its numeric id, its name (for example claude-opus-5-5 or gpt-6-sol) or its display name. ' +
  'get_leaderboard lists the tracked models with their ids.';
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };

const INSTRUCTIONS = `AI Stupid Level (ASL, aistupidlevel.info) publishes benchmark scores for the major LLM APIs on coding, reasoning and tool use, with drift signals and incidents. These tools read its Data API and, with a router key, use its Smart Router.

- Start with get_leaderboard or get_recommendations; they also give the model ids the other tools take.
- Free Data API keys allow 10 requests a day and 1 a minute. Answers are cached for a while, so repeating a question is free, but avoid calling many different data tools in a row on a free key.
- preview_route shows which model the Smart Router would pick for a prompt and why, without calling it. ask_router sends the prompt through the router using the account's own provider keys (set sandbox: true for a mock answer that spends nothing).
- Cite aistupidlevel.info as the source when you repeat the data.`;

export function createServer(options: ServerOptions = {}): McpServer {
  const cfg = resolveConfig(options);
  const data = new DataApi(cfg);
  const router = new RouterApi(cfg);

  const server = new McpServer(
    {
      name: 'aistupidlevel',
      title: 'AI Stupid Level',
      version: VERSION,
      websiteUrl: LINKS.site,
      description: 'LLM benchmark rankings, drift status and incidents from AI Stupid Level, plus its Smart Router.',
      // No `sizes`: the 2025-11-25 spec makes it a string array, but clients on earlier MCP SDKs
      // (mcp-proxy 5.x, which Glama's checks run through) validate it as a string and refuse to connect.
      icons: [{ src: 'https://aistupidlevel.info/apple-touch-icon.png', mimeType: 'image/png' }],
    },
    { instructions: INSTRUCTIONS },
  );

  const run = <A>(fn: (args: A) => Promise<string>) => async (args: A): Promise<Text> => {
    try {
      return { content: [{ type: 'text', text: await fn(args) }] };
    } catch (err) {
      if (err instanceof ToolError) return { isError: true, content: [{ type: 'text', text: err.message }] };
      cfg.log(`unexpected error: ${(err as Error)?.stack ?? err}`);
      return { isError: true, content: [{ type: 'text', text: `Unexpected error: ${(err as Error)?.message ?? err}` }] };
    }
  };
  const done = (body: string, r: DataResult) => `${body}\n\n${footer(r, data.quota)}`;

  /** The model's row in the newest leaderboard fetched so far (never makes a request). */
  const cachedRow = (id: number): { row: any; period?: string } | null => {
    const board = data.lastBoard;
    const row = board && Array.isArray(board.data) ? (board.data as any[]).find(m => Number(m.id) === id) : null;
    return row ? { row, period: board!.period } : null;
  };

  // ── Leaderboard ────────────────────────────────────────────────────────────

  server.registerTool('get_leaderboard', {
    title: 'LLM leaderboard',
    description:
      'Ranking of the LLM APIs AI Stupid Level tracks (OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM models) by benchmark score, 0-100. ' +
      'Use it to find the best model overall or for coding, reasoning or tool use, to compare models, and to get the model ids the other tools accept. ' +
      'Each row has the score, trend, status, stability and when it was last updated.',
    inputSchema: {
      sort_by: z.enum(['combined', 'coding', 'reasoning', 'tooling', 'price']).optional()
        .describe('Which ranking: combined (default, all suites), coding, reasoning, tooling (tool use / agentic tasks), or price (score per list-price dollar).'),
      period: PERIOD.optional().describe(PERIOD_HELP),
      vendor: z.string().optional().describe('Only show models from this vendor: openai, anthropic, google, deepseek, kimi or glm.'),
      limit: z.number().int().min(1).max(50).optional().describe('How many models to show (default 10).'),
    },
    annotations: { title: 'LLM leaderboard', ...READ },
  }, run(async ({ sort_by, period, vendor, limit }) => {
    const sortBy = sort_by ?? 'combined';
    const r = await data.get<any[]>('/models', { period, sortBy: sortBy === 'combined' ? undefined : sortBy });
    if (!Array.isArray(r.body.data)) throw new ToolError('The Data API returned a leaderboard in an unexpected format.');
    const all = r.body.data;
    const rows = all.map((m, i) => {
      const s = typeof m.currentScore === 'number' ? m.currentScore : null;
      // Equal scores share a rank; in the price view the order is the ranking.
      const rank = sortBy === 'price' || s === null ? i + 1 : all.findIndex(x => x.currentScore === s) + 1;
      return { m, rank, joint: sortBy !== 'price' && s !== null && all.filter(x => x.currentScore === s).length > 1 };
    });
    const wanted = vendor ? vendor.trim().toLowerCase() : null;
    const picked = rows.filter(({ m }) => !wanted || String(m.vendor ?? m.provider).toLowerCase() === wanted).slice(0, limit ?? 10);
    const p = r.body.period ?? period ?? '';
    const head = `AI Stupid Level leaderboard: ${sortBy === 'price' ? 'score per list-price dollar' : `${sortBy} score`}, ${PERIOD_LABEL[p] ?? p} view. ` +
      `${all.length} models tracked${wanted ? `; showing ${wanted}` : ''}. Scores are 0-100; equal scores share a rank.`;
    if (!picked.length) return done(`${head}\n\nNo models${wanted ? ` from "${vendor}"` : ''} in this view.`, r);
    const lines = picked.map(({ m, rank, joint }) => {
      const parts = [
        `${joint ? '=' : ''}${rank}. ${modelLabel(m)}`,
        String(m.vendor ?? m.provider ?? ''),
        typeof m.currentScore === 'number' ? `score ${m.currentScore}` : `score ${m.currentScore ?? 'n/a'}`,
      ];
      if (m.trend) parts.push(`trend ${m.trend}`);
      if (m.status) parts.push(`status ${m.status}`);
      if (typeof m.stability === 'number') parts.push(`stability ${m.stability}`);
      if (typeof m.dataPoints === 'number') parts.push(`${m.dataPoints} data points`);
      if (Array.isArray(m.suites) && m.suites.length) parts.push(`suites: ${m.suites.map(suiteName).join(', ')}`);
      if (sortBy === 'price' && m.pricing && typeof m.pricing.input === 'number') parts.push(`list price $${m.pricing.input}/$${m.pricing.output} per 1M input/output tokens`);
      if (m.lastUpdated) parts.push(`updated ${when(m.lastUpdated)}`);
      if (m.isStale) parts.push(`STALE${m.staleReason ? `: ${m.staleReason}` : ''}`);
      if (m.rankable === false) parts.push('not ranked (incomplete coverage)');
      return parts.filter(Boolean).join(' · ');
    });
    return done(`${head}\n\n${lines.join('\n')}`, r);
  }));

  // ── One model ──────────────────────────────────────────────────────────────

  server.registerTool('get_model', {
    title: 'Model details',
    description:
      'Details AI Stupid Level holds on one tracked LLM: vendor, version, notes on how it is called and priced, tool-calling support, ' +
      'how long it has been tracked, and its leaderboard row when one has been fetched.',
    inputSchema: { model: z.string().min(1).describe(MODEL_HELP) },
    annotations: { title: 'Model details', ...READ },
  }, run(async ({ model }) => {
    const ref = await data.resolveModel(model);
    const r = await data.get<any>(`/models/${ref.id}`);
    const m = r.body.data ?? {};
    const lines = [modelLabel({ ...ref, ...m })];
    const meta = [m.vendor && `vendor ${m.vendor}`, m.version && `version ${m.version}`, typeof m.daysTracked === 'number' && `tracked for ${m.daysTracked} days`]
      .filter(Boolean).join(' · ');
    if (meta) lines.push(meta);
    if (m.isCalibrating) lines.push(`Still calibrating: scores settle after ${m.calibrationDays ?? 'its first'} days of runs.`);
    if (m.isNew) lines.push('Recently added.');
    if (typeof m.supportsToolCalling === 'boolean') {
      lines.push(`Tool calling: ${m.supportsToolCalling ? `supported${m.maxToolsPerCall ? ` (up to ${m.maxToolsPerCall} tools per call)` : ''}` : 'not supported'}`);
    }
    if (typeof m.usesReasoningEffort === 'boolean') lines.push(`Benchmarked with a reasoning-effort setting: ${m.usesReasoningEffort ? 'yes' : 'no'}`);
    if (m.showInRankings === false) lines.push('Not shown in the public rankings.');
    if (m.latestScoreLocked) lines.push('Newest-run score: needs a paid Data API key (see get_leaderboard for the 24h/7d/30-day scores).');
    else if (m.latestScore !== null && m.latestScore !== undefined) {
      const ls = m.latestScore;
      lines.push(`Newest-run score: ${typeof ls === 'object' ? `${num(ls.stupidScore ?? ls.score)}${ls.timestamp ? ` (${when(ls.timestamp)})` : ''}` : num(ls)}`);
    }
    if (m.notes) lines.push(`Notes: ${m.notes}`);
    const row = cachedRow(ref.id);
    if (row) {
      const x = row.row;
      lines.push(`Leaderboard (${PERIOD_LABEL[row.period ?? ''] ?? row.period ?? ''} view): score ${num(x.currentScore)}, trend ${x.trend ?? 'n/a'}, status ${x.status ?? 'n/a'}, stability ${num(x.stability)}`);
    }
    return done(lines.join('\n'), r);
  }));

  server.registerTool('get_model_history', {
    title: 'Model score history',
    description:
      'Score history of one LLM on AI Stupid Level: each benchmark run in the window with its score, plus the newest run\'s per-axis results ' +
      '(correctness, code quality, efficiency, …). Use it to see whether a model got better or worse over time.',
    inputSchema: {
      model: z.string().min(1).describe(MODEL_HELP),
      period: PERIOD.optional().describe(PERIOD_HELP),
      max_points: z.number().int().min(1).max(200).optional().describe('How many runs to list, newest first (default 30). The summary always covers every run.'),
    },
    annotations: { title: 'Model score history', ...READ },
  }, run(async ({ model, period, max_points }) => {
    const ref = await data.resolveModel(model);
    const r = await data.get<any[]>(`/models/${ref.id}/history`, { period });
    const pts = (Array.isArray(r.body.data) ? r.body.data : [])
      .filter(x => x && typeof x.score === 'number')
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const p = r.body.period ?? period ?? '';
    const name = modelLabel(data.knownModel(ref.id) ?? ref);
    if (!pts.length) return done(`No scored runs for ${name} in the ${PERIOD_LABEL[p] ?? p} window.`, r);
    const scores = pts.map(x => x.score as number);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const lines = [
      `Score history for ${name}, ${PERIOD_LABEL[p] ?? p} window: ${pts.length} runs from ${when(pts[pts.length - 1].timestamp)} to ${when(pts[0].timestamp)}.`,
      `Newest ${pts[0].score}, oldest ${pts[pts.length - 1].score}, mean ${mean.toFixed(1)}, range ${Math.min(...scores)}-${Math.max(...scores)}.`,
    ];
    const axes = pts[0].axes && typeof pts[0].axes === 'object' ? Object.entries(pts[0].axes as Record<string, unknown>) : [];
    if (axes.length) lines.push(`Newest run by axis: ${axes.map(([k, v]) => `${axisName(k)} ${pct(v)}`).join(', ')}.`);
    lines.push('', 'Runs, newest first:');
    for (const x of pts.slice(0, max_points ?? 30)) {
      lines.push(`${when(x.timestamp)}  ${x.score}${x.suite && x.suite !== 'combined' ? ` (${suiteName(x.suite)})` : ''}`);
    }
    if (pts.length > (max_points ?? 30)) lines.push(`… ${pts.length - (max_points ?? 30)} older runs not listed.`);
    return done(lines.join('\n'), r);
  }));

  server.registerTool('get_drift_status', {
    title: 'Model drift status',
    description:
      'Whether an LLM\'s measured performance has shifted: AI Stupid Level\'s drift signature for one model, with its regime (stable, ' +
      'degrading, …), current score against its baseline, the change-point detector per benchmark suite, the last significant change ' +
      'and which axes moved. Use it to answer "has model X got worse?" or "is X being nerfed?".',
    inputSchema: { model: z.string().min(1).describe(MODEL_HELP) },
    annotations: { title: 'Model drift status', ...READ },
  }, run(async ({ model }) => {
    const ref = await data.resolveModel(model);
    const r = await data.get<any>(`/drift/${ref.id}`);
    const d = r.body.data ?? {};
    const name = modelLabel({ ...(data.knownModel(ref.id) ?? ref), name: d.modelName ?? ref.name, id: d.modelId ?? ref.id });
    const lines = [`Drift status for ${name}: ${d.driftStatus ?? 'unknown'}, regime ${d.regime ?? 'unknown'}${d.timestamp ? ` (computed ${when(d.timestamp)})` : ''}.`];
    const ci = Array.isArray(d.confidenceInterval) && d.confidenceInterval.length === 2 ? ` (95% CI ${d.confidenceInterval[0]}-${d.confidenceInterval[1]})` : '';
    lines.push(`Current score ${num(d.currentScore)}${ci}, baseline ${num(d.baselineScore)}${d.suite ? `, on the ${suiteName(d.suite)} suite` : ''}.`);
    if (typeof d.variance24h === 'number') lines.push(`Variance over 24 h: ${d.variance24h}.`);
    if (d.lastSignificantChange) lines.push(`Last significant change: ${when(d.lastSignificantChange)}${typeof d.hoursSinceChange === 'number' ? ` (${d.hoursSinceChange} h ago)` : ''}.`);
    const ph = d.pageHinkleyBySuite && typeof d.pageHinkleyBySuite === 'object' ? Object.entries(d.pageHinkleyBySuite as Record<string, any>) : [];
    if (ph.length) {
      lines.push('', 'Change-point detector (Page-Hinkley) by suite:');
      for (const [suite, s] of ph) {
        const state = s.fired ? 'FIRED: a sustained shift was detected' : s.armed === false ? `not armed yet (cold start, ${s.days ?? 0} of ${s.coldStart ?? '?'} days)` : 'no shift detected';
        lines.push(`- ${suiteName(suite)}: ${state}; statistic ${num(s.cusum, 3)} vs threshold ${num(s.threshold, 2)}, ${s.days ?? '?'} days of data`);
      }
    }
    const axes = d.axes && typeof d.axes === 'object' ? Object.entries(d.axes as Record<string, any>) : [];
    if (axes.length) {
      lines.push('', 'Axes (newest value, trend, change in points vs earlier runs):');
      for (const [k, a] of axes) {
        lines.push(`- ${axisName(k)}: ${pct(a.value)}, ${a.trend ?? 'n/a'}${typeof a.changeMagnitude === 'number' ? ` (${a.changeMagnitude > 0 ? '+' : ''}${a.changeMagnitude})` : ''}${a.status && a.status !== 'STABLE' ? `, ${a.status}` : ''}${a.comparable === false ? ', not comparable (test changed)' : ''}`);
      }
    }
    if (d.dataSource || d.axesSource) lines.push('', `Data source: scores ${d.dataSource ?? 'n/a'}, axes ${d.axesSource ?? 'n/a'}${typeof d.windowHours === 'number' ? `; window ${d.windowHours} h` : ''}.`);
    return done(lines.join('\n'), r);
  }));

  // ── Fleet-wide ─────────────────────────────────────────────────────────────

  server.registerTool('get_incidents', {
    title: 'Recent incidents',
    description:
      'Recent incidents AI Stupid Level recorded: provider-wide degradations and model-level problems, with severity, the models affected, ' +
      'when each was detected and whether and when it was resolved.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('How many incidents to show, newest first (default 10).'),
      open_only: z.boolean().optional().describe('Only incidents that are not resolved yet (default false).'),
      provider: z.string().optional().describe('Only incidents for this provider: openai, anthropic, google, deepseek, kimi or glm.'),
    },
    annotations: { title: 'Recent incidents', ...READ },
  }, run(async ({ limit, open_only, provider }) => {
    // Always the same request, so every variant of this question shares one cached answer.
    const r = await data.get<any[]>('/incidents', { limit: 50 });
    const want = provider?.trim().toLowerCase();
    const list = (Array.isArray(r.body.data) ? r.body.data : [])
      .filter(i => !open_only || !i.resolvedAt)
      .filter(i => !want || String(i.provider).toLowerCase() === want)
      .slice(0, limit ?? 10);
    const scope = `${open_only ? 'open ' : ''}incidents${want ? ` for ${want}` : ''}`;
    if (!list.length) return done(`No ${scope} in AI Stupid Level's recent record.`, r);
    const lines = [`Recent ${scope} (newest first):`];
    for (const i of list) {
      const resolved = i.resolvedAt
        ? `resolved ${when(i.resolvedAt)} (after ${ago(Date.parse(i.resolvedAt) - Date.parse(i.detectedAt))})`
        : 'OPEN';
      lines.push('', `#${i.id} [${i.severity ?? 'n/a'}] ${i.title ?? i.incidentType ?? 'Incident'}`);
      lines.push(`  ${[i.provider, i.modelName && !String(i.incidentType).startsWith('provider') ? `model ${i.modelName}` : null, `detected ${when(i.detectedAt)}`, resolved].filter(Boolean).join(' · ')}`);
      const affected = i.metadata?.affectedModels;
      if (Array.isArray(affected) && affected.length) lines.push(`  Affected models: ${affected.join(', ')}`);
      if (i.description) lines.push(`  ${truncate(String(i.description), 400)}`);
    }
    return done(lines.join('\n'), r);
  }));

  server.registerTool('get_provider_status', {
    title: 'Provider status',
    description:
      'Current status of each LLM provider\'s API as AI Stupid Level\'s health probes see it (OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM): ' +
      'operational or not, probe response time, the last error and when it was checked. For past outages use get_incidents.',
    inputSchema: {},
    annotations: { title: 'Provider status', ...READ },
  }, run(async () => {
    const r = await data.get<Record<string, any>>('/providers');
    const entries = r.body.data && typeof r.body.data === 'object' ? Object.entries(r.body.data) : [];
    if (!entries.length) return done('The Data API returned no provider status.', r);
    const lines = ['Provider API status (AI Stupid Level health probes):'];
    for (const [name, s] of entries) {
      lines.push(`- ${name}: ${s?.status ?? 'unknown'}${typeof s?.responseTime === 'number' ? ` · probe answered in ${s.responseTime} ms` : ''} · checked ${when(s?.lastChecked)}${s?.error ? ` · last error: ${truncate(String(s.error), 200)}` : ''}`);
    }
    return done(lines.join('\n'), r);
  }));

  server.registerTool('get_recommendations', {
    title: 'Model recommendations',
    description:
      'AI Stupid Level\'s current picks: the best model for coding, the most reliable (steadiest score), the fastest, the best value ' +
      '(most points per measured dollar among near-top models), models that cost far more than an equally good alternative, and models to ' +
      'avoid right now. Each pick comes with the reason and the evidence it rests on. Use it for "which model should I use?".',
    inputSchema: { period: PERIOD.optional().describe(PERIOD_HELP) },
    annotations: { title: 'Model recommendations', ...READ },
  }, run(async ({ period }) => {
    const r = await data.get<Record<string, any>>('/analytics/recommendations', { period });
    const d = r.body.data && typeof r.body.data === 'object' ? r.body.data : {};
    const LABEL: Record<string, string> = {
      bestForCode: 'Best for coding', mostReliable: 'Most reliable', fastestResponse: 'Fastest response',
      bestValue: 'Best value', poorValue: 'Poor value (a cheaper model scores as well or better)', avoidNow: 'Avoid right now',
    };
    const pick = (x: any) => {
      const bits = [`${modelLabel(x)}${x.vendor ? ` · ${x.vendor}` : ''}${typeof x.displayScore === 'number' ? ` · leaderboard score ${x.displayScore}` : typeof x.score === 'number' ? ` · score ${x.score}` : ''}`];
      if (x.reason) bits.push(`  Why: ${x.reason}`);
      if (x.evidence) bits.push(`  Evidence: ${x.evidence}`);
      return bits.join('\n');
    };
    const p = r.body.period ?? period ?? '';
    const lines = [`AI Stupid Level recommendations, ${PERIOD_LABEL[p] ?? p} view:`];
    for (const [key, v] of Object.entries(d)) {
      const label = LABEL[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
      if (Array.isArray(v)) {
        lines.push('', `${label}:${v.length ? '' : ' none'}`);
        for (const x of v) lines.push(`- ${pick(x)}`);
      } else {
        lines.push('', `${label}: ${v ? pick(v) : 'none in this view'}`);
      }
    }
    return done(lines.join('\n'), r);
  }));

  server.registerTool('get_global_index', {
    title: 'Global AI index',
    description:
      'AI Stupid Level\'s global index: one 0-100 number for the tracked models together, now and over the last 24 hours, with its trend ' +
      'and how many models are performing well. Use it for "are AI models worse today?".',
    inputSchema: {},
    annotations: { title: 'Global AI index', ...READ },
  }, run(async () => {
    const r = await data.get<any>('/index');
    const d = r.body.data ?? {};
    const lines = [`AI Stupid Level global index: ${num(d.current?.globalScore)} now${d.current?.modelsCount ? ` across ${d.current.modelsCount} models` : ''}, trend ${d.trend ?? 'n/a'}.`];
    if (typeof d.performingWell === 'number' && typeof d.totalModels === 'number') lines.push(`Models performing well: ${d.performingWell} of ${d.totalModels}.`);
    if (Array.isArray(d.history) && d.history.length) {
      lines.push(`History: ${d.history.map((h: any) => `${h.label ?? when(h.timestamp)} ${num(h.globalScore)}`).join(', ')}.`);
    }
    return done(lines.join('\n'), r);
  }));

  // ── Smart Router ───────────────────────────────────────────────────────────

  const MODE = z.enum(ROUTING_MODES).optional().describe(
    'Routing mode (default auto = the strategy saved in the account): auto-best (highest combined score), auto-coding, auto-reasoning, ' +
    'auto-tooling (top model on that benchmark), auto-task (reads the prompt and picks the benchmark), auto-value, auto-value-coding, ' +
    'auto-value-reasoning, auto-value-tooling (most points per measured dollar among models within 5 points of the best), ' +
    'auto-fastest-quality, auto-consistent (fastest or steadiest near-top model), auto-fastest, auto-cheapest (no quality bar).',
  );
  const PIN = z.string().optional().describe('Pin a specific model id (for example gpt-6-sol) instead of a routing mode.');
  const SANDBOX = z.boolean().optional().describe(
    'Sandbox: run the real routing as if the account had a key for every provider and return a mock answer. Nothing is called, spent or counted.',
  );
  const messagesFor = (prompt: string, system?: string) => [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ];

  server.registerTool('preview_route', {
    title: 'Preview Smart Router choice',
    description:
      'Which model the AI Stupid Level Smart Router would send a prompt to, and why: the routing strategy, the chosen model and provider ' +
      'with its benchmark score and estimated cost, and the fallback chain. Nothing is sent to a model and nothing is counted. Needs a router key (ASL_ROUTER_KEY).',
    inputSchema: {
      prompt: z.string().min(1).describe('The prompt to route (the decision can depend on it, for example with auto-task).'),
      system: z.string().optional().describe('An optional system message.'),
      mode: MODE,
      pin_model: PIN,
      sandbox: SANDBOX,
    },
    annotations: { title: 'Preview Smart Router choice', ...READ },
  }, run(async ({ prompt, system, mode, pin_model, sandbox }) => {
    const model = pin_model?.trim() || mode || 'auto';
    const { data: p } = await router.request('POST', '/route/preview', { model, messages: messagesFor(prompt, system) }, { sandbox });
    const sel = (s: any) => s
      ? `${s.model ?? 'unknown'}${s.provider ? ` (${s.provider})` : ''}${typeof s.score === 'number' ? `, score ${s.score}` : ''}${typeof s.estimated_cost_usd === 'number' ? `, estimated cost ${usd(s.estimated_cost_usd)}` : ''}${s.reasoning ? `. Why: ${s.reasoning}` : ''}`
      : 'none';
    const lines = [`Smart Router decision for ${p.requested_model ?? model}${p.strategy ? ` (strategy ${p.strategy})` : ''}${p.sandbox ? ', sandbox: as if the account had a key for every provider' : ''}:`];
    lines.push(`Primary: ${sel(p.primary)}`);
    const fb = Array.isArray(p.fallbacks) ? p.fallbacks : [];
    if (fb.length) {
      lines.push(`Fallbacks${p.fallback_enabled === false ? ' (fallback is switched off for this key)' : ''}:`);
      fb.forEach((f: any, i: number) => lines.push(`${i + 1}. ${sel(f)}`));
    } else lines.push('Fallbacks: none');
    lines.push('', 'Nothing was sent to a model and nothing was counted.');
    return lines.join('\n');
  }));

  server.registerTool('ask_router', {
    title: 'Ask via Smart Router',
    description:
      'Send a prompt through the AI Stupid Level Smart Router and return the answer, together with which model answered, its provider, why ' +
      'the router chose it and the latency. The router calls the model with the provider keys saved in the user\'s ASL account, so a real call ' +
      'is billed by that provider and counts against the router plan; set sandbox: true for a free mock answer. Needs a router key (ASL_ROUTER_KEY).',
    inputSchema: {
      prompt: z.string().min(1).describe('The user message to send.'),
      system: z.string().optional().describe('An optional system message.'),
      mode: MODE,
      pin_model: PIN,
      max_tokens: z.number().int().min(1).max(128_000).optional().describe('Upper bound on the answer length in tokens.'),
      reasoning_effort: z.enum(['low', 'medium', 'high']).optional().describe('Reasoning effort for models that support it.'),
      sandbox: SANDBOX,
    },
    annotations: { title: 'Ask via Smart Router', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, run(async ({ prompt, system, mode, pin_model, max_tokens, reasoning_effort, sandbox }) => {
    const model = pin_model?.trim() || mode || 'auto';
    const body: Record<string, unknown> = { model, messages: messagesFor(prompt, system) };
    if (max_tokens) body.max_completion_tokens = max_tokens;
    if (reasoning_effort) body.reasoning_effort = reasoning_effort;
    const { data: c, routing } = await router.request('POST', '/chat/completions', body, { sandbox, idempotent: true });
    const choice = c?.choices?.[0];
    const answer = typeof choice?.message?.content === 'string' && choice.message.content
      ? choice.message.content
      : choice?.message?.refusal ? `(The model declined: ${choice.message.refusal})` : '(The model returned no text.)';
    const info = [
      `Answered by ${routing.model ?? c?.model ?? 'unknown model'}${routing.provider ? ` (${routing.provider})` : ''} via the AI Stupid Level Smart Router, mode ${model}.`,
    ];
    if (routing.reasoning) info.push(`Why this model: ${routing.reasoning}`);
    if (routing.fallback) info.push('A fallback model answered because the first choice failed.');
    const facts = [
      routing.latencyMs !== null ? `latency ${routing.latencyMs} ms` : null,
      c?.usage ? `tokens ${c.usage.prompt_tokens ?? '?'} in / ${c.usage.completion_tokens ?? '?'} out` : null,
      choice?.finish_reason && choice.finish_reason !== 'stop' ? `finish reason ${choice.finish_reason}` : null,
      routing.requestId ? `request id ${routing.requestId}` : null,
    ].filter(Boolean);
    if (facts.length) info.push(`${facts.join(' · ')}.`);
    if (routing.sandbox || sandbox || cfg.forceSandbox) info.push('Sandbox: this is a mock answer from real routing; no provider was called and nothing was spent or counted.');
    return `${answer}\n\n---\n${info.join('\n')}`;
  }));

  server.registerTool('get_usage', {
    title: 'ASL usage and limits',
    description:
      'This month\'s Smart Router usage for the configured router key (requests used and left, prepaid credits, the key\'s budget), and the ' +
      'Data API requests left today for the configured data key. Use it when a tool reports a limit, or to check the keys work.',
    inputSchema: {},
    annotations: { title: 'ASL usage and limits', ...READ },
  }, run(async () => {
    if (!router.hasKey && !data.hasKey) {
      throw new ToolError(`No AI Stupid Level key is configured. Set ASL_DATA_KEY (create one at ${LINKS.dataKeys}) and/or ASL_ROUTER_KEY (create one at ${LINKS.routerKeys}) in this MCP server's "env" configuration.`);
    }
    const lines: string[] = [];
    if (router.hasKey) {
      try {
        const { data: u } = await router.request('GET', '/usage');
        const req = u?.requests ?? {};
        lines.push(`Smart Router (${u?.period ?? 'this month'}, plan ${u?.plan ?? 'unknown'}): ${req.unlimited ? `${req.used ?? 0} requests, unlimited` : `${req.used ?? 0} of ${req.included ?? '?'} requests used, ${req.remaining ?? '?'} left`}` +
          `${u?.credits ? `; prepaid credits: ${u.credits.requests ?? 0} requests${u.credits.in_use ? ' (in use)' : ''}` : ''}; a routed request would ${u?.allowed === false ? 'NOT ' : ''}be accepted now.`);
        const b = u?.key?.budget;
        if (u?.key) lines.push(`Key ${u.key.name ?? ''} (${u.key.prefix ?? ''}…)${b ? `: spent $${num(b.spent_this_month_usd, 2)} this month${typeof b.monthly_limit_usd === 'number' ? ` of a ${b.hard_limit ? 'hard' : 'soft'} $${b.monthly_limit_usd} budget` : ', no budget set'}` : ''}${u.key.expires_at ? `, expires ${when(u.key.expires_at)}` : ''}.`);
      } catch (err) {
        if (!(err instanceof ToolError)) throw err;
        lines.push(`Smart Router: ${err.message}`);
      }
    } else lines.push(`Smart Router: no router key configured (ASL_ROUTER_KEY; create one at ${LINKS.routerKeys}).`);
    if (data.hasKey) {
      let q = data.quota;
      let tier = '';
      if (!q) {
        try {
          const r = await data.get<any>('/me');
          q = data.quota;
          const me: any = r.body;
          if (me?.key?.tier) tier = `, ${me.key.tier} tier`;
          if (me?.limits) tier += ` (${me.limits.requests_per_day} a day, ${me.limits.requests_per_minute} a minute)`;
        } catch (err) {
          if (!(err instanceof ToolError)) throw err;
          lines.push(`Data API: ${err.message}`);
        }
      }
      if (q) lines.push(`Data API${tier}: ${q.remaining} of ${q.limit} requests left today; resets ${q.resetAt ? when(q.resetAt) : 'at 00:00 UTC'}.`);
    } else lines.push(`Data API: no data key configured (ASL_DATA_KEY; create one at ${LINKS.dataKeys}).`);
    return lines.join('\n');
  }));

  // ── Prompt ─────────────────────────────────────────────────────────────────

  server.registerPrompt('choose_model', {
    title: 'Choose an LLM for a task',
    description: 'Pick the LLM API to use for a task, from AI Stupid Level\'s rankings, recommendations and drift data.',
    argsSchema: { task: z.string().describe('What the model will be used for, e.g. "refactoring a large TypeScript codebase".') },
  }, ({ task }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text:
          `I need to choose an LLM API for this task: ${task}\n\n` +
          'Use the AI Stupid Level tools. Start with get_recommendations; if the task is mainly coding, reasoning or tool use, also call ' +
          'get_leaderboard with that sort_by. Check get_drift_status for the top candidate. Then recommend one model and a cheaper ' +
          'alternative, citing the scores and the evidence the tools returned, and cite aistupidlevel.info as the source. ' +
          'A free Data API key allows 1 request a minute, so make as few data calls as you need.',
      },
    }],
  }));

  if (cfg.warnings.data) cfg.log(cfg.warnings.data);
  if (cfg.warnings.router) cfg.log(cfg.warnings.router);
  return server;
}
