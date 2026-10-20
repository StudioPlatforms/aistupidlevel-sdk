import { DataApiError, type DataApiResult, type RateInfo } from "./data-api";

/** The subset of Raycast's `Cache` this module needs, so it can be tested without Raycast. */
export interface KeyValueStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface CacheEntry<T> {
  savedAt: number;
  data: T;
  rate: RateInfo | null;
}

export interface CachedResult<T> extends CacheEntry<T> {
  /** True when the answer came from the cache rather than the network. */
  fromCache: boolean;
  /** Set when the network failed and an older answer is shown instead. */
  error: DataApiError | null;
}

export function readEntry<T>(store: KeyValueStore, key: string): CacheEntry<T> | null {
  const raw = store.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (typeof parsed?.savedAt !== "number" || !("data" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isFresh(entry: CacheEntry<unknown> | null, now: number, ttlMs: number): boolean {
  return !!entry && now - entry.savedAt >= 0 && now - entry.savedAt < ttlMs;
}

/**
 * Serve from the cache while it is fresh; otherwise ask the network once. If the network refuses
 * (rate limit, daily quota, outage) and an older answer exists, return that with the error attached
 * instead of failing, because a free key only has 10 requests a day.
 */
export async function loadWithCache<T>(opts: {
  store: KeyValueStore;
  key: string;
  ttlMs: number;
  now?: () => number;
  force?: boolean;
  fetcher: () => Promise<DataApiResult<T>>;
}): Promise<CachedResult<T>> {
  const now = opts.now ?? Date.now;
  const entry = readEntry<T>(opts.store, opts.key);
  if (!opts.force && entry && isFresh(entry, now(), opts.ttlMs)) {
    return { ...entry, fromCache: true, error: null };
  }
  try {
    const result = await opts.fetcher();
    const fresh: CacheEntry<T> = { savedAt: now(), data: result.data, rate: result.rate };
    opts.store.set(opts.key, JSON.stringify(fresh));
    return { ...fresh, fromCache: false, error: null };
  } catch (error) {
    if (entry && error instanceof DataApiError && error.canUseStale) {
      return { ...entry, fromCache: true, error };
    }
    throw error;
  }
}
