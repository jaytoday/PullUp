import { useBeforeLeave, useSearchParams } from "@solidjs/router";
import { onCleanup, onMount, Show } from "solid-js";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadError, PageHeader, PageSkeleton } from "@/components/layout/repo-layout";
import { SettingsCard } from "@/components/settings/field-row";
import { LimitsCard } from "@/components/settings/basic/limits-card";
import { RequireHumanCard } from "@/components/settings/basic/require-human-card";
import { ReviewersCard } from "@/components/settings/basic/reviewers-card";
import { ReviewFocusCard } from "@/components/settings/basic/review-focus-card";
import { SeverityCard } from "@/components/settings/basic/severity-card";
import { RulesCard } from "@/components/settings/basic/rules-card";
import { ChecksCard } from "@/components/settings/basic/checks-card";
import { PathsSection } from "@/components/settings/advanced/paths-section";
import { DependenciesSection } from "@/components/settings/advanced/dependencies-section";
import { AuthorsSection, TestsSection } from "@/components/settings/advanced/tests-authors-section";
import { FreezeSection } from "@/components/settings/advanced/freeze-section";
import { SignalsSection } from "@/components/settings/advanced/signals-section";
import { CustomQuestionsSection } from "@/components/settings/advanced/custom-questions-section";
import { EconomicsSection, GatesSection } from "@/components/settings/advanced/economics-section";
import { EffectiveView, JsonEditor } from "@/components/settings/expert/json-editor";
import { VersionHistory } from "@/components/settings/expert/version-history";
import { PreviewSheet } from "@/components/settings/preview-sheet";
import { SaveDialog } from "@/components/settings/save-dialog";
import { SettingsHeader, UnsavedBar } from "@/components/settings/settings-header";
import { SettingsProvider, useSettings } from "@/components/settings/settings-context";
import { safeLatest } from "@/lib/state";

const TABS = ["basic", "advanced", "expert"] as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function AdvancedTab() {
  const s = useSettings();
  const count = (paths: string[]) => s.changes().filter((c) => paths.some((p) => c.path.startsWith(p))).length;
  const Trigger = (props: { title: string; summary: string; prefixes: string[] }) => (
    <AccordionTrigger class="px-5">
      <span class="flex flex-1 items-baseline gap-3 text-left">
        <span class="text-sm font-semibold">{props.title}</span>
        <span class="text-xs font-normal text-muted-foreground">{props.summary}</span>
        <Show when={count(props.prefixes) > 0}>
          <span class="ml-auto mr-3 rounded border border-band-review/50 px-1 text-[10px] text-band-review">{count(props.prefixes)} edited</span>
        </Show>
      </span>
    </AccordionTrigger>
  );
  const tiers = () => s.get<string[]>("guardrails.tiers.high")?.length ?? 0;
  return (
    <Accordion multiple class="overflow-hidden rounded-lg border border-border bg-card" data-testid="advanced-accordion">
      <AccordionItem value="paths">
        <Trigger title="Paths & tiers" summary={`approvable up to ${s.get<string>("guardrails.approveMaxTier")} · ${tiers()} high-tier rule${tiers() === 1 ? "" : "s"}`} prefixes={["policy.", "guardrails.tiers", "guardrails.approveMaxTier", "guardrails.sizeExcludeGlobs"]} />
        <AccordionContent class="px-5">
          <PathsSection />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="dependencies">
        <Trigger title="Dependencies" summary={plural((s.get<string[]>("guardrails.dependencies.autoApprove") ?? []).length, "update kind") + " auto-approvable"} prefixes={["guardrails.dependencies"]} />
        <AccordionContent class="px-5">
          <DependenciesSection />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="tests">
        <Trigger title="Tests" summary={s.get<boolean>("guardrails.tests.requireForBehaviorChange") ? "test changes required" : "tests not required"} prefixes={["guardrails.tests"]} />
        <AccordionContent class="px-5">
          <TestsSection />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="authors">
        <Trigger title="Authors" summary={`AI-authored ×${s.get<number>("guardrails.authors.aiSizeMultiplier")} size`} prefixes={["guardrails.authors"]} />
        <AccordionContent class="px-5">
          <AuthorsSection />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="freeze">
        <Trigger title="Freeze windows" summary={plural((s.get<unknown[]>("guardrails.freezeWindows") ?? []).length, "window")} prefixes={["guardrails.freezeWindows"]} />
        <AccordionContent class="px-5">
          <FreezeSection />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="signals">
        <Trigger title="Risk signals (Jev)" summary={`thresholds · questions · budget`} prefixes={["jev.mode", "jev.thresholds", "jev.disabledQuestions", "severity.questionLevels", "jev.budget", "jev.concurrency", "jev.requests", "jev.multiplier"]} />
        <AccordionContent class="px-5">
          <SignalsSection />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="questions">
        <Trigger title="Custom risk questions" summary={`${(s.get<unknown[]>("jev.customQuestions") ?? []).length} of 3`} prefixes={["jev.customQuestions"]} />
        <AccordionContent class="px-5 pb-4">
          <CustomQuestionsSection />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="economics">
        <Trigger title="Economics (cost priors)" summary="waiting · defects · efficacy · value" prefixes={["value", "cold", "conflict", "escalation", "defect", "typeDefect", "review", "efficacy", "delay", "change", "default", "maxWait", "minWait"]} />
        <AccordionContent class="px-5 pb-4">
          <EconomicsSection />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="gates">
        <Trigger title="Calibration gates" summary="the bar for applying calibration and un-stubbing approval" prefixes={["jev.gate"]} />
        <AccordionContent class="px-5 pb-4">
          <GatesSection />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function SettingsPage() {
  const s = useSettings();
  const [params, setParams] = useSearchParams<{ tab?: string }>();
  const tab = () => (TABS.includes(params.tab as (typeof TABS)[number]) ? params.tab! : "basic");

  // Don't lose a draft by navigating away (it also survives a reload).
  useBeforeLeave((e) => {
    if (s.dirty() && !e.defaultPrevented && !window.confirm("You have unsaved settings changes. Leave anyway? (Your draft is kept.)")) {
      e.preventDefault();
    }
  });
  const onUnload = (e: BeforeUnloadEvent) => {
    if (s.dirty()) e.preventDefault();
  };
  onMount(() => window.addEventListener("beforeunload", onUnload));
  onCleanup(() => window.removeEventListener("beforeunload", onUnload));

  return (
    <Show when={!s.server.error} fallback={<LoadError error={s.server.error as Error} reset={() => location.reload()} />}>
      <Show when={safeLatest(s.server)} fallback={<PageSkeleton />}>
        <div class="space-y-5 pb-16">
          <PageHeader
            title="Settings"
            description="How PullUp's CI gate works for this repo: what it may do on GitHub, how big a change it may approve, and what always needs a person."
          />
          <UnsavedBar />
          <SettingsHeader />
          <Tabs value={tab()} onChange={(t) => setParams({ tab: t === "basic" ? undefined : t })}>
            <TabsList>
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
              <TabsTrigger value="expert">Expert</TabsTrigger>
            </TabsList>
            <TabsContent value="basic" class="mt-4 space-y-4">
              <LimitsCard />
              <SeverityCard />
              <RequireHumanCard />
              <RulesCard />
              <ReviewersCard />
              <ReviewFocusCard />
              <ChecksCard />
            </TabsContent>
            <TabsContent value="advanced" class="mt-4">
              <AdvancedTab />
            </TabsContent>
            <TabsContent value="expert" class="mt-4 space-y-4">
              <SettingsCard title="Effective settings" description="Every value in force for this repo and where it comes from: default · file · saved · edited.">
                <div class="py-3">
                  <EffectiveView />
                </div>
              </SettingsCard>
              <SettingsCard title="Repo settings JSON" description="The saved layer on top of pullup.config.json. Validated live against the same schema the server enforces.">
                <div class="py-3">
                  <JsonEditor />
                </div>
              </SettingsCard>
              <SettingsCard title="Version history" description="Every save is a new version. Restoring creates a new version rather than rewinding.">
                <VersionHistory />
              </SettingsCard>
            </TabsContent>
          </Tabs>
          <SaveDialog />
          <PreviewSheet />
        </div>
      </Show>
    </Show>
  );
}

export default function RepoSettings() {
  return (
    <SettingsProvider>
      <SettingsPage />
    </SettingsProvider>
  );
}
