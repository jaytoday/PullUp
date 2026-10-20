// Shared offline harness for the actuator and conformance tests: a fake
// ReviewClient (never the network), a trusted store, and govern → apply.
import type { PlannedReviewAction, PullStore } from "@pullup/core";
import {
  DECISION_COMMENT_MARKER,
  InMemoryStore,
  LoggingReviewActuator,
  agentIdentity,
  approvalGate,
  enrollRepo,
  ensureAgent,
  governPlan,
  resolveDelivery,
  setAgentStatus,
} from "@pullup/core";
import type { ReviewClient } from "./actuator.js";
import { GitHubReviewActuator } from "./actuator.js";
import { staticBroker } from "./credentials.js";

export const NOW = "2026-09-24T12:00:00.000Z";
export const REPO = "acme/api";
export const KEY = "test-permit-key";
export const CONFIG_HASH = "cfg-hash-1";
export const AGENT = agentIdentity({ id: "pullup/test" });

type Call = { fn: string; args: Record<string, unknown> };

const STATE: Record<string, string> = { APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED", COMMENT: "COMMENTED" };

export function fakeClient(opts: { state?: string; head?: string; fail?: Partial<Record<string, number>>; existingComment?: number } = {}) {
  const calls: Call[] = [];
  let nextId = 100;
  const comments = new Map<number, string>(opts.existingComment ? [[opts.existingComment, DECISION_COMMENT_MARKER]] : []);
  const reviews: Array<{ id: number; state: string; commitId: string | null }> = [];
  const maybeFail = (fn: string) => {
    const status = opts.fail?.[fn];
    if (status) throw Object.assign(new Error(`${fn} failed`), { status });
  };
  const client: ReviewClient = {
    async getPull(args) {
      calls.push({ fn: "getPull", args });
      maybeFail("getPull");
      return { state: opts.state ?? "open", headSha: opts.head ?? "sha2" };
    },
    async createReview(args) {
      calls.push({ fn: "createReview", args });
      maybeFail("createReview");
      const id = nextId++;
      reviews.push({ id, state: STATE[args.event]!, commitId: args.commit_id });
      return { id };
    },
    async dismissReview(args) {
      calls.push({ fn: "dismissReview", args });
      maybeFail("dismissReview");
    },
    async findComment(args) {
      calls.push({ fn: "findComment", args });
      const ids = [...comments.entries()].filter(([, body]) => body.includes(args.marker)).map(([id]) => id);
      return ids.at(-1) ?? null;
    },
    async createComment(args) {
      calls.push({ fn: "createComment", args });
      const id = nextId++;
      comments.set(id, args.body);
      return { id };
    },
    async updateComment(args) {
      calls.push({ fn: "updateComment", args });
      maybeFail("updateComment");
      comments.set(args.comment_id, args.body);
      return { id: args.comment_id };
    },
    async requestReviewers(args) {
      calls.push({ fn: "requestReviewers", args });
      maybeFail("requestReviewers");
    },
    async listReviews(args) {
      calls.push({ fn: "listReviews", args });
      maybeFail("listReviews");
      return reviews;
    },
  };
  return { client, calls, reviews, fns: () => calls.map((c) => c.fn) };
}

/** A store with the repo enrolled in `review` and the test agent approved. */
export async function trustedStore(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await enrollRepo(store, { repoId: REPO, profile: "review", by: "test", now: NOW });
  const rec = await ensureAgent(store, AGENT, NOW);
  await setAgentStatus(store, { agent: rec!, status: "approved", by: "test", now: NOW });
  return store;
}

export const guard = (configHash = CONFIG_HASH) => ({ permitKey: KEY, agent: AGENT, configHash: async () => configHash });

/** planReviewActions output → governed (task, authorization, permit), as every surface does. */
export function govern(store: PullStore, actions: readonly PlannedReviewAction[], over: { now?: string; permitKey?: string | null; credential?: "app" | "standing-token" } = {}) {
  return governPlan(store, actions, {
    repoId: REPO,
    initiator: { kind: "cli", ref: "test" },
    agent: AGENT,
    config: { version: null, hash: CONFIG_HASH },
    delivery: "live",
    credential: over.credential ?? "app",
    permitKey: over.permitKey === undefined ? KEY : over.permitKey,
    sign: true,
    now: over.now ?? NOW,
  });
}

export function actuator(client: ReviewClient, store: PullStore, opts: { now?: string; configHash?: string; kind?: "app" | "standing-token"; onMint?: (r: string, p: unknown) => void; onRevoke?: () => void } = {}) {
  return new GitHubReviewActuator(staticBroker(client, opts.kind ?? "app", { onMint: opts.onMint, onRevoke: opts.onRevoke }), store, {
    guard: guard(opts.configHash),
    now: () => opts.now ?? NOW,
  });
}

/** Governs, then applies. */
export async function send(client: ReviewClient, store: PullStore, actions: readonly PlannedReviewAction[]) {
  return actuator(client, store).apply(await govern(store, actions));
}

export function planned(over: Partial<PlannedReviewAction> & Pick<PlannedReviewAction, "action">): PlannedReviewAction {
  const event = over.action === "approve" ? "APPROVE" : over.action === "request_changes" ? "REQUEST_CHANGES" : "COMMENT";
  const headSha = over.headSha ?? "sha2";
  return {
    repoId: REPO,
    pullNumber: 7,
    headSha,
    source: "tcm",
    recommendation: "auto-approve",
    band: null,
    reason: "r",
    authority: "act",
    call: {
      createReview:
        over.action === "defer_to_human"
          ? null
          : { owner: "acme", repo: "api", pull_number: 7, commit_id: headSha, event, body: "body" },
      upsertComment: null,
      requestReviewers: null,
    },
    ...over,
  };
}

export const comment = (body = "c") => ({ owner: "acme", repo: "api", issue_number: 7, marker: DECISION_COMMENT_MARKER, body });

