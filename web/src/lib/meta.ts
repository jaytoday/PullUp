// One source of truth for how bands, recommendations, and bot actions look
// everywhere in the app (label, token colour class, icon).

import type { Component } from "solid-js";
import {
  ArrowUpRight,
  CircleCheck,
  CircleDot,
  Clock,
  GitPullRequestClosed,
  MessageSquareWarning,
  ShieldAlert,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-solid";
import type { PullDecision } from "./api";

type Icon = Component<{ class?: string }>;

export type Band = NonNullable<PullDecision["risk"]>["band"];
export type Recommendation = PullDecision["recommendation"];

export interface Meta {
  readonly label: string;
  /** Text colour class. */
  readonly text: string;
  /** Soft background + border classes for badges/pills. */
  readonly soft: string;
  /** Solid fill class (bars, dots). */
  readonly fill: string;
  readonly icon: Icon;
  readonly hint: string;
}

export const BANDS: Record<Band, Meta> = {
  escalate: {
    label: "Escalate",
    text: "text-band-escalate",
    soft: "bg-band-escalate/12 border-band-escalate/35 text-band-escalate",
    fill: "bg-band-escalate",
    icon: ShieldAlert as Icon,
    hint: "Policy rule, escalating signal, or injection tripwire — a human must review.",
  },
  "review-with-rationale": {
    label: "Review",
    text: "text-band-review",
    soft: "bg-band-review/12 border-band-review/35 text-band-review",
    fill: "bg-band-review",
    icon: MessageSquareWarning as Icon,
    hint: "Medium-risk signal or unevaluated code — a reviewer with a written rationale.",
  },
  standard: {
    label: "Standard",
    text: "text-band-standard",
    soft: "bg-band-standard/10 border-band-standard/30 text-band-standard",
    fill: "bg-band-standard",
    icon: CircleDot as Icon,
    hint: "No notable signal — the two-cost model decides.",
  },
  "fast-path": {
    label: "Fast path",
    text: "text-band-fast",
    soft: "bg-band-fast/12 border-band-fast/35 text-band-fast",
    fill: "bg-band-fast",
    icon: Zap as Icon,
    hint: "Allowlisted low-risk change, every signal high-confidence. Approval is logged only.",
  },
};

export const BAND_ORDER: readonly Band[] = ["escalate", "review-with-rationale", "standard", "fast-path"];

export const RECOMMENDATIONS: Record<Recommendation, Meta> = {
  escalate: { ...BANDS.escalate, label: "Escalate" },
  "request-changes": {
    label: "Request changes",
    text: "text-clay",
    soft: "bg-clay/12 border-clay/35 text-clay",
    fill: "bg-clay",
    icon: GitPullRequestClosed as Icon,
    hint: "Blocking human finding, or the change is already net-negative.",
  },
  "keep-reviewing": {
    label: "Keep reviewing",
    text: "text-muted-foreground",
    soft: "bg-muted border-border text-muted-foreground",
    fill: "bg-muted-foreground",
    icon: Clock as Icon,
    hint: "Wait < w*: another hour of review still pays for itself.",
  },
  "auto-approve": {
    label: "Auto-approve",
    text: "text-primary",
    soft: "bg-primary/12 border-primary/35 text-primary",
    fill: "bg-primary",
    icon: Sparkles as Icon,
    hint: "Wait ≥ w*: further review no longer pays (recommendation only).",
  },
  "review-complete": {
    label: "Review complete",
    text: "text-muted-foreground",
    soft: "bg-secondary border-border text-muted-foreground",
    fill: "bg-muted-foreground",
    icon: CircleCheck as Icon,
    hint: "Merged, closed, or a human already approved.",
  },
};

export type BotAction = "approve" | "request_changes" | "defer_to_human";

export const ACTIONS: Record<BotAction, Meta & { event: string }> = {
  approve: { ...RECOMMENDATIONS["auto-approve"], label: "Approve", event: "APPROVE", icon: CircleCheck as Icon },
  request_changes: { ...RECOMMENDATIONS["request-changes"], label: "Request changes", event: "REQUEST_CHANGES" },
  defer_to_human: {
    ...BANDS.escalate,
    label: "Defer to human",
    event: "COMMENT",
    icon: UserRound as Icon,
    hint: "Comment + request reviewers.",
  },
};

export const LinkArrow = ArrowUpRight as Icon;
