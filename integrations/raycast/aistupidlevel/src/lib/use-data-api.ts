import { Cache, Toast, getPreferenceValues, showToast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useRef } from "react";
import { type CachedResult, loadWithCache } from "./cache";
import { DATA_CACHE_TTL_MS } from "./constants";
import { dataApiGet } from "./data-api";
import { relativeTime } from "./format";

const cache = new Cache({ namespace: "data-api" });

/** Cache entries are per key, so two accounts never share answers. Only a short prefix is used. */
function keyTag(apiKey: string | undefined): string {
  return (apiKey ?? "").trim().slice(0, 17) || "none";
}

/**
 * Load one Data API path, reusing a stored answer for 15 minutes. The free tier allows
 * 10 requests a day and 1 a minute, so each screen makes at most one request, and only when its
 * stored answer is older than that or the user asks to refresh.
 */
export function useDataApi<T>(path: string | null) {
  const { dataApiKey } = getPreferenceValues<Preferences>();
  const abortable = useRef<AbortController | null>(null);
  const force = useRef(false);

  const result = usePromise(
    async (p: string | null, key: string | undefined): Promise<CachedResult<T> | null> => {
      if (!p) return null;
      const forced = force.current;
      force.current = false;
      return loadWithCache<T>({
        store: cache,
        key: `${keyTag(key)}:${p}`,
        ttlMs: DATA_CACHE_TTL_MS,
        force: forced,
        fetcher: () => dataApiGet<T>(p, key, { signal: abortable.current?.signal }),
      });
    },
    [path, dataApiKey],
    { abortable, onError: () => undefined },
  );

  // When the network refused and a stored answer is shown instead, say so once.
  const staleError = result.data?.error ?? null;
  useEffect(() => {
    if (!staleError || !result.data) return;
    showToast({
      style: Toast.Style.Failure,
      title: `Showing data from ${relativeTime(result.data.savedAt)}`,
      message: staleError.message,
    });
  }, [staleError, result.data?.savedAt]);

  return {
    ...result,
    refresh: () => {
      force.current = true;
      result.revalidate();
    },
  };
}
