// A store for previews: reads go through to the real store, writes stay in
// memory, so a previewed branch never reaches the history that drives the
// cost model, calibration or outcomes. One deliberate exception: signal
// answers (a content-addressed cache keyed by model, question set and hunk
// content) are written through, so the real pull request later reuses them.

import type { PullStore } from "../schema/store.js";
import { InMemoryStore } from "../schema/store.js";

/** Methods whose writes may reach the real store. */
const PASS_THROUGH_WRITES = new Set<string>(["upsertSignal"]);
/** Reads answered from both stores (real first, then the overlay). */
const MERGED_LISTS = new Set<string>(["listPulls", "listHunks", "listSignalRuns", "listReviewActions", "listFindingComments", "listVerdicts"]);
const OVERLAY_FIRST_GETS = new Set<string>(["getPull", "getRepository"]);

export function createOverlayStore(real: PullStore): PullStore & { readonly overlay: InMemoryStore } {
  const overlay = new InMemoryStore();
  const handler: ProxyHandler<PullStore> = {
    get(target, prop, receiver) {
      if (prop === "overlay") return overlay;
      if (prop === "kind") return "memory";
      const name = String(prop);
      const realFn = Reflect.get(target, prop, receiver) as unknown;
      if (typeof realFn !== "function") return realFn;
      const overlayFn = (overlay as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
      if (PASS_THROUGH_WRITES.has(name)) return (realFn as (...a: unknown[]) => unknown).bind(target);
      if (/^(upsert|replace|record|append|insert|set|consume)/.test(name)) return overlayFn!.bind(overlay);
      if (MERGED_LISTS.has(name)) {
        return async (...args: unknown[]) => {
          const a = (await (realFn as (...x: unknown[]) => Promise<unknown[]>).apply(target, args)) ?? [];
          const b = (await overlayFn!.apply(overlay, args)) as unknown[];
          return [...a, ...b];
        };
      }
      if (OVERLAY_FIRST_GETS.has(name)) {
        return async (...args: unknown[]) => (await overlayFn!.apply(overlay, args)) ?? (await (realFn as (...x: unknown[]) => Promise<unknown>).apply(target, args));
      }
      return (realFn as (...a: unknown[]) => unknown).bind(target);
    },
  };
  return new Proxy(real, handler) as PullStore & { readonly overlay: InMemoryStore };
}
