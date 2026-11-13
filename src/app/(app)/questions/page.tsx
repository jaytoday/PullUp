import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { AutoRefresh } from "@/components/common/auto-refresh";
import { EmptyState } from "@/components/common/empty-state";
import { QuestionCard } from "@/components/runs/question-card";
import { Button } from "@/components/ui/button";
import { shortSha } from "@/lib/format";
import { openQuestions } from "@/server/dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Questions" };

export default async function QuestionsPage() {
  const open = await openQuestions();
  return (
    <DashboardPanel title="Questions waiting for a person">
      <AutoRefresh />
      <PageBody>
        <p className="text-sm text-muted-foreground">
          The person asked answers by email or phone through the temporary legacy notification service, with the Pass / Fail buttons on the PullUp check, or by commenting <code className="font-mono">/pullup pass &lt;reason&gt;</code> or <code className="font-mono">/pullup fail &lt;reason&gt;</code> on the pull request. Repo admins can answer too.
        </p>
        {open.length ? (
          open.map(({ run, question, state }) => (
            <div key={`${run.id}-${question.question.id}`} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-foreground">
                  {run.repo}
                  {run.pull ? ` #${run.pull}` : ""} <span className="font-mono text-xs text-muted-foreground">{shortSha(run.headSha)}</span>
                </span>
                <span className="flex gap-1">
                  <Button href={`/runs/${run.id}`} color="neutral" variant="ghost" size="sm">Run</Button>
                  {run.pull ? (
                    <Button href={`https://github.com/${run.repo}/pull/${run.pull}/checks`} target="_blank" color="neutral" variant="outline" size="sm" trailingIcon="i-lucide-arrow-up-right">
                      Answer on GitHub
                    </Button>
                  ) : null}
                </span>
              </div>
              <QuestionCard q={question} ask={state} />
            </div>
          ))
        ) : (
          <EmptyState icon="i-lucide-message-circle-question" title="Nothing is waiting for a person" description="When PullUp cannot settle a question on an active repository, it shows up here until someone answers or the deadline passes." action={{ href: "/runs", label: "See runs" }} />
        )}
      </PageBody>
    </DashboardPanel>
  );
}
