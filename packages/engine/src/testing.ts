import type { Concern } from "./config";
import type { Assessment } from "./policy";

/** A small seeded random generator, so property tests and synthetic data are repeatable. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An assessment with sensible defaults, for tests. */
export function assessment(concern: Concern, over: Partial<Assessment> = {}): Assessment {
  return { concern, provider: "test", status: "decided", answer: "safe", final: true, probability: null, citations: [], verified: [], synthetic: false, decisionId: null, costUsd: 0, answeredBy: "fast", error: null, ...over };
}
