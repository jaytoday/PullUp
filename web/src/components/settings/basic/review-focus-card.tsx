import { createMemo, For, Show } from "solid-js";
import { ShieldCheck } from "lucide-solid";
import { REVIEW_FOCUS_LIMITS, screenFreeText } from "@pullup/core/config-schema";
import { Textarea } from "@/components/ui/textarea";
import { FieldRow, SettingsCard } from "../field-row";
import { useSettings } from "../settings-context";

/**
 * Optional free text for the rationale writer. Screened as you type with the
 * same rules the server enforces; it can never change a decision.
 */
export function ReviewFocusCard() {
  const s = useSettings();
  const text = () => s.get<string>("review.focus") ?? "";
  const screen = createMemo(() => screenFreeText(text(), REVIEW_FOCUS_LIMITS));
  return (
    <SettingsCard
      title="Review focus (optional)"
      description="Tell the rationale writer what your team cares about. It shapes the written explanation only — never the decision."
      id="review-focus"
    >
      <FieldRow path="review.focus" label="Review focus" help={null} stacked hideError>
        <div class="space-y-2">
          <Textarea
            value={text()}
            onInput={(e) => s.set("review.focus", e.currentTarget.value)}
            maxLength={REVIEW_FOCUS_LIMITS.maxChars + 40}
            showCount={false}
            rows={3}
            placeholder="e.g. We care most about tenant isolation in src/billing; flag any change to retry logic."
            aria-label="Review focus"
            aria-invalid={!screen().ok}
          />
          <div class="flex items-start justify-between gap-4 text-xs">
            <Show
              when={!screen().ok}
              fallback={
                <span class="inline-flex items-center gap-1.5 text-muted-foreground">
                  <ShieldCheck class="size-3.5 text-primary" />
                  Screened: plain text, no links, no instructions to approve or skip checks.
                </span>
              }
            >
              <ul class="space-y-0.5 text-destructive" role="alert" data-testid="focus-problems">
                <For each={screen().problems}>{(p) => <li>Review focus {p}.</li>}</For>
              </ul>
            </Show>
            <span class={`num shrink-0 ${screen().normalized.length > REVIEW_FOCUS_LIMITS.maxChars ? "text-destructive" : "text-muted-foreground"}`}>
              {screen().normalized.length} / {REVIEW_FOCUS_LIMITS.maxChars}
            </span>
          </div>
        </div>
      </FieldRow>
    </SettingsCard>
  );
}
