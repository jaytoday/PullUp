import type { AgentSession } from "./tools";

/**
 * The scripted planner: the same tools in a fixed order, with no model. Used
 * in demo mode and whenever no agent model key is set, so the demo and the
 * tests need no model.
 */
export async function runScripted(session: AgentSession): Promise<void> {
  const tools = new Map(session.tools().map((t) => [t.name, t]));
  const call = (name: string, args: Record<string, unknown> = {}) => tools.get(name)!.run(args);
  await call("get_ci_summary");
  for (const c of session.ctx.concerns) {
    if (c.concern === "flaky_retry") {
      const job = session.ctx.run.jobs.find((j) => j.attempts.some((a) => a.conclusion !== "success" && a.conclusion !== "skipped"));
      if (job) await call("read_log", { workflow: job.workflow, job: job.name });
    } else {
      await call("read_diff", { path: c.evidence.find((e) => e.source === "diff")?.where });
    }
    const r = (await call("assess", { concern: c.concern })) as { status?: string };
    if (r.status === "input_required") await call("answer_input_request", { concern: c.concern });
  }
  await call("finish", { note: "scripted planner" });
}
