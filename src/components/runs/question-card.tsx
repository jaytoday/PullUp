import type { AskState, ResolvedQuestion } from "@pullup/engine";
import { Badge } from "@/components/ui/badge";
import { QuestionStatus } from "./question-status";

const VERDICT = { pass: "success", fail: "error", "needs-person": "warning" } as const;
const OUTCOME: Record<string, string> = { pass: "Passed", fail: "Failed", ask: "Needs a person" };

/**
 * One question: what fired, the evidence, each seat's answer with the quotes
 * that checked out (and the ones that did not), and who settled it. Never
 * animated: a person reads this before answering.
 */
export function QuestionCard({ q, ask }: { q: ResolvedQuestion; ask?: AskState }) {
  return (
    <section className="space-y-4 rounded-lg bg-background p-4 ring ring-border" data-testid={`question-${q.question.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 gap-3">
          <QuestionStatus outcome={q.outcome} />
          <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">{q.question.id}</p>
          <h3 className="font-medium text-foreground">{q.question.summary}</h3>
          <p className="text-sm text-muted-foreground">{q.question.prompt}</p>
          </div>
        </div>
        <Badge color={q.outcome === "pass" ? "success" : q.outcome === "fail" ? "error" : "warning"} variant="subtle">
          {OUTCOME[q.outcome]}
          {q.question.councilMayPass ? "" : " · a person decides"}
        </Badge>
      </header>
      {q.question.evidence.length ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Evidence</p>
          <ul className="space-y-1 font-mono text-xs">
            {q.question.evidence.map((e, i) => (
              <li key={i} className="overflow-x-auto rounded bg-elevated px-2 py-1 whitespace-pre text-body">
                <span className="text-muted-foreground">
                  {e.where}
                  {e.line ? `:${e.line}` : ""}{" "}
                </span>
                {e.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {q.seats.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {q.seats.map((s) => (
            <div key={s.seat} className="space-y-2 rounded-md bg-muted/60 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{s.seat.split(":")[0]}</span>
                <Badge color={VERDICT[s.verdict]} variant="soft" size="sm">
                  {s.verdict} · {s.strength}
                </Badge>
              </div>
              {s.reason ? <p className="text-body">{s.reason}</p> : null}
              {s.validQuotes.map((quote, i) => (
                <blockquote key={i} className="border-s-2 border-success ps-2 font-mono text-xs text-body">
                  {quote.text} <span className="text-muted-foreground">({quote.source}, checks out)</span>
                </blockquote>
              ))}
              {s.problems.map((p, i) => (
                <p key={i} className="text-xs text-warning">
                  {p}
                </p>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-sm text-foreground">
        <span className="font-medium">Decision: </span>
        {q.reason}
      </p>
      {ask ? <AskLine ask={ask} /> : null}
    </section>
  );
}

function AskLine({ ask }: { ask: AskState }) {
  const deadline = new Date(ask.deadline).toLocaleString();
  return (
    <p className="text-xs text-muted-foreground">
      Asked {ask.asked.join(", then ")}
      {ask.answer ? ` · ${ask.answer.by} answered "${ask.answer.value}"${ask.answer.reason ? `: ${ask.answer.reason}` : ""}` : ask.noAnswer ? ` · no answer: ${ask.noAnswer.reason} (option "${ask.noAnswer.option}")` : ` · deadline ${deadline}`}
      {ask.remindedAt ? " · reminded once" : ""}
    </p>
  );
}
