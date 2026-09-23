// App-level state: the view mode (off / shadow / active) lives in the URL
// (`?mode=`) so every view is linkable. It only changes what the API computes
// for display — it never writes config.

import { useLocation, useSearchParams } from "@solidjs/router";
import type { JevMode } from "./api";

const MODES: readonly JevMode[] = ["off", "shadow", "active"];

/** Default view is shadow: observe the Jev layer without it changing anything. */
export const DEFAULT_MODE: JevMode = "shadow";

export function useMode(): [() => JevMode, (m: JevMode) => void] {
  const [params, setParams] = useSearchParams<{ mode?: string }>();
  const mode = () => {
    const m = params.mode as JevMode | undefined;
    return m && MODES.includes(m) ? m : DEFAULT_MODE;
  };
  return [mode, (m) => setParams({ mode: m === DEFAULT_MODE ? undefined : m })];
}

/** Keeps `?mode=` when linking between pages. */
export function withMode(path: string, mode: JevMode): string {
  return mode === DEFAULT_MODE ? path : `${path}?mode=${mode}`;
}

/** Active repo from the URL (/r/:owner/:repo/...), if any. */
export function useActiveRepo(): () => string | null {
  const location = useLocation();
  return () => {
    const m = location.pathname.match(/^\/r\/([^/]+)\/([^/]+)/);
    return m ? `${m[1]}/${m[2]}` : null;
  };
}

/**
 * A resource's latest value without throwing: Solid rethrows a resource's error
 * when `.latest` is read in the errored state, so error-aware views read this.
 */
export function safeLatest<T>(r: { readonly error: unknown; readonly latest: T | undefined }): T | undefined {
  return r.error ? undefined : r.latest;
}
