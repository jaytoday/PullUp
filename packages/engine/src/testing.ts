import type { Council, RawSeatAnswer } from "./council";

/** A small seeded random generator, so property tests are repeatable. */
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

/** A fake council that gives every seat the same answer, and counts its calls. */
export function fixedCouncil(answer: unknown): Council & { calls: number } {
  const council = (async (_q, _run, seats) => {
    council.calls += seats.length;
    return seats.map((seat): RawSeatAnswer => ({ seat, answer }));
  }) as Council & { calls: number };
  council.calls = 0;
  return council;
}

/**
 * A fake council whose seats answer at random: any verdict and strength, quotes
 * taken from the question's evidence or made up, malformed answers and failed
 * calls. Used to check that the rules hold whatever the council says.
 */
export function randomCouncil(random: () => number): Council & { calls: number } {
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const council = (async (question, _run, seats) => {
    council.calls += seats.length;
    return seats.map((seat): RawSeatAnswer => {
      const roll = random();
      if (roll < 0.05) return { seat, answer: null, error: "timeout" };
      if (roll < 0.1) return { seat, answer: { verdict: "maybe", strength: 9 } };
      const quotes = Array.from({ length: Math.floor(random() * 3) }, () =>
        random() < 0.5 && question.evidence.length
          ? (({ source, text }) => ({ source, text }))(pick(question.evidence))
          : { source: pick(["diff", "log", "report"] as const), text: "a quote the model made up" },
      );
      return { seat, answer: { verdict: pick(["pass", "fail", "needs-person"] as const), strength: 1 + Math.floor(random() * 5), reason: "r", quotes } };
    });
  }) as Council & { calls: number };
  council.calls = 0;
  return council;
}
