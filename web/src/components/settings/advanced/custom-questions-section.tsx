import { createSignal, For, Show } from "solid-js";
import { FlaskConical, Plus, Trash2 } from "lucide-solid";
import { CUSTOM_QUESTION_PREFIX, screenCustomQuestion, type CustomQuestion } from "@pullup/core/config-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, api, type TryQuestionResponse } from "@/lib/api";
import { pct } from "@/lib/format";
import { FieldRow } from "../field-row";
import { useSettings } from "../settings-context";

const MAX = 3;

function QuestionRow(props: { index: number; value: string; onChange: (v: string) => void; onRemove: () => void }) {
  const s = useSettings();
  const screen = () => screenCustomQuestion(props.value);
  const [tried, setTried] = createSignal<TryQuestionResponse | null>(null);
  const [trying, setTrying] = createSignal(false);
  const [tryError, setTryError] = createSignal<string | null>(null);
  const tryIt = async () => {
    setTrying(true);
    setTryError(null);
    try {
      setTried(await api.tryQuestion(s.repoId(), props.value));
    } catch (err) {
      setTryError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTrying(false);
    }
  };
  return (
    <div class="space-y-2 rounded-md border border-border bg-background/40 p-3" data-testid="custom-question">
      <div class="flex items-center gap-2">
        <span class="shrink-0 text-sm text-muted-foreground">{CUSTOM_QUESTION_PREFIX}</span>
        <Input
          value={props.value}
          maxLength={160}
          onInput={(e) => {
            props.onChange(e.currentTarget.value);
            setTried(null);
          }}
          placeholder="change how invoice totals are rounded"
          aria-label={`Custom question ${props.index + 1}`}
          aria-invalid={!screen().ok}
          class="h-8"
        />
        <span class="text-sm text-muted-foreground">?</span>
        <Button variant="secondary" size="sm" onClick={() => void tryIt()} disabled={!screen().ok || trying()}>
          <Show when={trying()} fallback={<FlaskConical />}>
            <Spinner size="sm" />
          </Show>
          Try
        </Button>
        <Button variant="ghost" size="icon" class="size-8" aria-label={`Remove custom question ${props.index + 1}`} onClick={props.onRemove}>
          <Trash2 />
        </Button>
      </div>
      <Show when={!screen().ok && props.value.trim() !== ""}>
        <ul class="text-xs text-destructive" role="alert">
          <For each={screen().problems}>{(p) => <li>Custom question {p}.</li>}</For>
        </ul>
      </Show>
      <Show when={tryError()}>
        <p class="text-xs text-destructive">{tryError()}</p>
      </Show>
      <Show when={tried()}>
        {(t) => (
          <div class="space-y-1 text-xs" data-testid="try-result">
            <div class="text-muted-foreground">
              On #{t().pullNumber} {t().title} · {t().model}
              <Show when={t().note}> · {t().note}</Show>
            </div>
            <For each={t().units}>
              {(u) => (
                <div class="flex items-center justify-between gap-3">
                  <span class="num truncate text-muted-foreground">{u.key}</span>
                  <span class={`num ${u.p !== null && u.p >= 0.5 ? "text-band-review" : ""}`}>P(yes) {u.p === null ? "—" : pct(u.p)}</span>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
}

/** Owner-written yes/no questions, template-constrained and raise-only. */
export function CustomQuestionsSection() {
  const s = useSettings();
  const list = () => s.get<CustomQuestion[]>("jev.customQuestions") ?? [];
  const write = (next: CustomQuestion[]) => s.set("jev.customQuestions", next);
  return (
    <FieldRow
      path="jev.customQuestions"
      help="Asked of every hunk. A “yes” can only route a PR to a reviewer — never escalate, never approve. Changing these re-versions the question set, resets calibration, and re-evaluates open PRs (a few cents)."
      stacked
      hideError
    >
      <div class="space-y-2">
        <For each={list()}>
          {(q, i) => (
            <QuestionRow
              index={i()}
              value={q.text}
              onChange={(v) => write(list().map((x, j) => (j === i() ? { text: v } : x)))}
              onRemove={() => write(list().filter((_, j) => j !== i()))}
            />
          )}
        </For>
        <Button variant="secondary" size="sm" onClick={() => write([...list(), { text: "" }])} disabled={list().length >= MAX}>
          <Plus /> Add question {list().length >= MAX ? `(max ${MAX})` : ""}
        </Button>
      </div>
    </FieldRow>
  );
}
