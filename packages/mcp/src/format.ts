/** Plain-text rendering of API answers: compact, readable by people and models alike. */
import type { DataResult, Quota } from './data-api.js';

/** 2026-10-20T06:00:00.239Z → 2026-10-20 06:00 UTC */
export function when(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'unknown';
  const d = new Date(typeof v === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v) ? `${v.replace(' ', 'T')}Z` : (v as any));
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

export const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)}%` : 'n/a');
export const num = (v: unknown, digits = 0) =>
  (typeof v === 'number' && Number.isFinite(v) ? (digits ? v.toFixed(digits) : String(Math.round(v))) : v === undefined || v === null ? 'n/a' : String(v));

/** "Claude Opus 5.5 (claude-opus-5-5, id 292)" */
export function modelLabel(m: { displayName?: unknown; name?: unknown; modelName?: unknown; id?: unknown; modelId?: unknown }): string {
  const name = (m.name ?? m.modelName) as string | undefined;
  const id = m.id ?? m.modelId;
  const display = typeof m.displayName === 'string' && m.displayName ? m.displayName : null;
  const inner = [display && name && display !== name ? name : null, id !== undefined && id !== null ? `id ${id}` : null].filter(Boolean).join(', ');
  return `${display ?? name ?? 'unknown model'}${inner ? ` (${inner})` : ''}`;
}

/** Source line, cache age and quota left: appended to every Data API answer. */
export function footer(r: DataResult, quota: Quota | null): string {
  const lines: string[] = [];
  const gen = r.body?.generated_at ? `, generated ${when(r.body.generated_at)}` : '';
  lines.push(`Source: AI Stupid Level Data API (aistupidlevel.info)${gen}. Attribution required: cite aistupidlevel.info as the source.`);
  if (r.staleReason) lines.push(`NOTE: this is an older cached answer, fetched ${ago(Date.now() - r.fetchedAt)} ago, because a fresh one could not be fetched: ${r.staleReason}`);
  else if (r.cached) lines.push(`Served from this server's cache (fetched ${ago(Date.now() - r.fetchedAt)} ago; no request was spent).`);
  if (quota) lines.push(`Data API requests left today for this key: ${quota.remaining} of ${quota.limit}.`);
  return lines.join('\n');
}

/** $0.012, $0.00075, $1.25: two significant digits below a dollar. */
export const usd = (v: number) => `$${v >= 1 ? v.toFixed(2) : Number(v.toPrecision(2))}`;

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
