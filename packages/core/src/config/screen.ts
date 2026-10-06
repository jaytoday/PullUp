// Free-text screening for the two places config accepts prose: the review
// focus (shown to the rationale LLM) and custom risk questions (asked of Jev).
//
// The real defence is structural — neither can choose a bot action (the engine
// picks actions from typed outputs; custom questions can only raise risk). This
// screen is a second layer: short, normalised, and free of the obvious
// injection carriers. It *rejects* rather than silently strips, so the owner
// sees exactly what tripped it. Browser-safe (no node imports).

export interface ScreenOptions {
  readonly maxChars: number;
  readonly maxLines?: number;
}

export interface ScreenResult {
  readonly ok: boolean;
  /** NFKC-normalised, whitespace-collapsed text (what would be stored). */
  readonly normalized: string;
  readonly problems: readonly string[];
}

// Zero-width, bidi overrides/isolates, BOM, and C0/C1 controls (tab/newline kept).
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

interface Pattern {
  readonly re: RegExp;
  readonly why: string;
}

/**
 * Whole-phrase instruction patterns. Deliberately phrase-level ("approve this",
 * not the bare word "approve") so "flag changes to the approval flow" passes.
 */
const PATTERNS: readonly Pattern[] = [
  { re: /<!--|-->/, why: "hidden HTML comment" },
  { re: /```|~~~/, why: "code fence" },
  { re: /<\/?[a-z][^>]*>/i, why: "HTML/XML tag" },
  { re: /\b(?:https?|ftp|file|data|javascript):/i, why: "URL" },
  { re: /\bwww\.[a-z0-9-]+\./i, why: "URL" },
  { re: /[A-Za-z0-9+/]{40,}={0,2}/, why: "encoded blob" },
  { re: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|preceding|other)\b/i, why: "instruction to ignore other rules" },
  { re: /\b(?:ignore|disregard|override)\s+(?:your|the|these|those)\s+(?:instructions|rules|policy|guardrails)\b/i, why: "instruction to ignore other rules" },
  { re: /(?:^|\s)(?:system|assistant|user|developer)\s*:/i, why: "chat role marker" },
  { re: /\byou\s+are\s+(?:now|an?|the)\b/i, why: "role assignment" },
  { re: /\bact\s+as\b/i, why: "role assignment" },
  { re: /(?:^|\s)\/(?:approve|lgtm|merge|ship|skip|lock|unlock|assign|close|ok-to-test|retest|override)\b/i, why: "slash command" },
  { re: /\b(?:auto-?approv\w*|pre-?approv\w*|lgtm)\b/i, why: "approval instruction" },
  { re: /\b(?:approve|merge|ship)\s+(?:this|these|it|all|every|any|the\s+(?:pr|pull|change))/i, why: "approval instruction" },
  { re: /\b(?:always|must|should)\s+(?:approve|merge|pass|accept)\b/i, why: "approval instruction" },
  { re: /\bskip\s+(?:the\s+)?(?:checks?|review|ci|tests?|escalation)\b/i, why: "instruction to skip checks" },
  { re: /\b(?:do\s+not|don'?t|never)\s+(?:escalate|flag|request\s+changes|block)\b/i, why: "instruction to suppress review" },
  { re: /\b(?:mark|treat|consider)\s+(?:\w+\s+){0,3}as\s+(?:safe|approved|low[- ]risk|reviewed)\b/i, why: "instruction to lower risk" },
];

export function normalizeFreeText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function screenFreeText(raw: string, opts: ScreenOptions): ScreenResult {
  const problems: string[] = [];
  if (INVISIBLE.test(raw)) problems.push("contains invisible or bidi-control characters");
  if (CONTROL.test(raw)) problems.push("contains control characters");
  // Only letter/digit changes count: NFKC also folds harmless punctuation (…, nbsp).
  const alnum = (x: string) => x.replace(/[^\p{L}\p{N}]/gu, "");
  if (alnum(raw.normalize("NFKC")) !== alnum(raw)) problems.push("contains look-alike (non-normalised) characters");

  const normalized = normalizeFreeText(raw.replace(new RegExp(INVISIBLE.source, "gu"), ""));
  if (normalized.length > opts.maxChars) problems.push(`is ${normalized.length} characters (max ${opts.maxChars})`);
  const lines = normalized === "" ? 0 : normalized.split("\n").length;
  if (opts.maxLines !== undefined && lines > opts.maxLines) problems.push(`has ${lines} lines (max ${opts.maxLines})`);

  const seen = new Set<string>();
  for (const p of PATTERNS) {
    const m = normalized.match(p.re);
    if (m && !seen.has(p.why)) {
      seen.add(p.why);
      problems.push(`contains ${p.why} ("${m[0].trim().slice(0, 40)}")`);
    }
  }
  return { ok: problems.length === 0, normalized, problems };
}

export const REVIEW_FOCUS_LIMITS: ScreenOptions = { maxChars: 280, maxLines: 4 };
export const CUSTOM_QUESTION_LIMITS: ScreenOptions = { maxChars: 120, maxLines: 1 };

/** Fixed template around a custom question fragment: "Does this code <fragment>?" */
export const CUSTOM_QUESTION_PREFIX = "Does this code";

/** Extra rules for a custom-question fragment on top of the generic screen. */
export function screenCustomQuestion(raw: string): ScreenResult {
  const base = screenFreeText(raw, CUSTOM_QUESTION_LIMITS);
  const problems = [...base.problems];
  const text = base.normalized.replace(/\?+$/, "").trim();
  if (text.length < 8) problems.push("is too short to be a meaningful question (min 8 characters)");
  if (/\?/.test(text)) problems.push("must be a single question (no '?' mid-text)");
  if (/[.!;]\s+\S/.test(text)) problems.push("must be one sentence");
  if (/^does this code\b/i.test(text)) problems.push(`should not repeat the fixed prefix "${CUSTOM_QUESTION_PREFIX}"`);
  return { ok: problems.length === 0, normalized: text, problems };
}

export function customQuestionText(fragment: string): string {
  return `${CUSTOM_QUESTION_PREFIX} ${normalizeFreeText(fragment).replace(/\?+$/, "").trim()}?`;
}

/** Stable id for a custom question: `custom:<slug>`. */
export function customQuestionId(fragment: string): string {
  const slug = normalizeFreeText(fragment)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return `custom:${slug || "question"}`;
}
