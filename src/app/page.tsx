import { ColorModeButton } from "@/components/app-shell/color-mode-button";
import { Icon } from "@/components/icon";
import { FeaturesSection } from "@/components/landing/features-section";
import { FlowBeams } from "@/components/landing/flow-beams";
import { HeroBackdrop } from "@/components/landing/hero-backdrop";
import { SiteFooter } from "@/components/landing/site-footer";
import { Wordmark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { BentoGrid, BentoGridItem } from "@/components/ui/bento-grid";
import { Button } from "@/components/ui/button";
import { Timeline } from "@/components/ui/timeline";

export const metadata = { title: { absolute: "PullUp: CI that knows when to ask" } };

const OUTCOMES = [
  {
    icon: "i-lucide-x",
    tone: "text-destructive bg-destructive/10",
    title: "Hard failure → fail",
    description: "A build error, or a test that failed again on rerun. No AI is called and no one is bothered.",
    className: "md:col-span-1",
  },
  {
    icon: "i-lucide-check",
    tone: "text-success bg-success/10",
    title: "Nothing tricky → pass",
    description: "Every required check passed and no trigger fired. No AI is called. Most runs end here.",
    className: "md:col-span-1",
  },
  {
    icon: "i-lucide-users",
    tone: "text-primary bg-primary/10",
    title: "Something tricky → the council",
    description: "A flaky test, weakened tests or a change to sign-in code. A few AI reviewers answer; a fixed rule in code turns their answers into pass, fail or ask a person.",
    className: "md:col-span-1",
  },
];

const FEATURES = [
  { title: "Code decides what is tricky", description: "A fixed list of triggers, not the AI, decides which runs need judgment. Target: under 15% of runs.", icon: "i-lucide-scan-search" },
  { title: "Quotes are checked", description: "A reviewer's fail counts only if its quote really appears in the diff or the log.", icon: "i-lucide-badge-check" },
  { title: "A person for the hard cases", description: "Sign-in code, migrations, payments and secrets go to the person you name, by email, phone, a button or a comment.", icon: "i-lucide-user-check" },
  { title: "Bounded waiting", description: "A deadline and a reminder, then your rule: fail, follow the council, pass, or ask a backup.", icon: "i-lucide-hourglass" },
  { title: "Shadow mode first", description: "A neutral check shows what PullUp would decide, so you can trust it before it blocks anything.", icon: "i-lucide-eye" },
  { title: "Config from the default branch", description: "A pull request can never loosen its own checks.", icon: "i-lucide-lock" },
  { title: "Every call on the record", description: "Each GitHub call needs a single-use permit, and every step goes on a hash-chained record.", icon: "i-lucide-scroll-text" },
  { title: "Answers that teach", description: "People's answers go back to your team's CI policy in WithAI, so the council learns your rules.", icon: "i-lucide-brain" },
];

const STEP = "rounded-lg bg-muted p-4 text-sm text-body ring ring-border";

const FLOW = [
  { title: "Collect", content: <p key="step-1" className={STEP}>When every required workflow has finished for a commit, PullUp reads the job results (with reruns), the end of each failed log and the pull request&apos;s diff. Its rules come from <code className="font-mono">.pullup/config.json</code> on the default branch.</p> },
  { title: "Decide what is tricky", content: <p key="step-2" className={STEP}>A hard failure fails at once. Otherwise each trigger looks for something that needs judgment: a test that passed only on rerun, tests skipped or deleted, a change under sign-in, migrations, payments, secrets or CI configuration. No trigger, no AI: the run passes.</p> },
  { title: "Ask the council", content: <p key="step-3" className={STEP}>For each question, three or four AI reviewers answer in parallel through WithAI, each from its own viewpoint, with your CI policy as guidance. Each answer is pass, fail or needs a person, with a strength and quotes.</p> },
  { title: "Apply the rule", content: <p key="step-4" className={STEP}>A fail with a quote that checks out fails the question. Every reviewer passing strongly passes it, if the trigger allows the council to. Anything else goes to a person, and the check shows who it is waiting for.</p> },
  { title: "Record", content: <p key="step-5" className={STEP}>The result, every answer and every GitHub call are kept on a hash-chained record. The dashboard shows how often the council agreed with people, per trigger.</p> },
];

export default function LandingPage() {
  return (
    <div className="min-h-svh bg-background text-body">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Wordmark />
          <nav className="flex items-center gap-1">
            <Button href="#how-it-works" color="neutral" variant="ghost" size="sm" className="hidden sm:inline-flex">
              How it works
            </Button>
            <Button href="/login" color="neutral" variant="outline" size="sm">
              Sign in
            </Button>
            <ColorModeButton />
          </nav>
        </div>
      </header>

      <section className="relative isolate overflow-hidden">
        <HeroBackdrop />
        <div className="mx-auto max-w-4xl px-4 pt-20 pb-10 text-center sm:px-6 sm:pt-28">
          <Badge color="primary" variant="soft" className="mb-5">A CI check, built on WithAI</Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-6xl">CI that knows when to ask</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-balance text-muted-foreground sm:text-lg">
            PullUp fails what is broken and passes what is plain, with no AI at all. For the few runs that need judgment, a council of AI reviewers answers, and a person settles what they cannot.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/login" color="primary" size="lg" trailingIcon="i-lucide-arrow-right">
              Get started
            </Button>
            <Button href="#how-it-works" color="neutral" variant="outline" size="lg">
              See how a run is decided
            </Button>
          </div>
        </div>
        <FlowBeams />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="outcomes">
        <h2 id="outcomes" className="mb-2 text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Every run ends one of three ways</h2>
        <p className="mx-auto mb-10 max-w-xl text-center text-sm text-muted-foreground">Code decides which way. The council only ever sees the third.</p>
        <BentoGrid className="md:auto-rows-auto">
          {OUTCOMES.map((o) => (
            <BentoGridItem
              key={o.title}
              className={`${o.className} border-border bg-background shadow-none dark:border-border dark:bg-background`}
              header={
                <span className={`flex size-10 items-center justify-center rounded-lg ${o.tone}`}>
                  <Icon name={o.icon} className="size-5" />
                </span>
              }
              title={<span className="text-foreground">{o.title}</span>}
              description={<span className="text-sm text-muted-foreground">{o.description}</span>}
            />
          ))}
        </BentoGrid>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6" aria-labelledby="features">
        <h2 id="features" className="sr-only">Features</h2>
        <FeaturesSection features={FEATURES} />
      </section>

      <section id="how-it-works" className="scroll-mt-14">
        <Timeline heading="How a run is decided" intro="Five steps, the same for every commit. Only the third one costs anything." data={FLOW} />
      </section>

      <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Start in shadow mode</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">Install the GitHub App, add a small config file, and watch what PullUp would decide on your real pull requests before it blocks anything.</p>
        <Button href="/login" color="primary" size="lg" className="mt-6" trailingIcon="i-lucide-arrow-right">
          Get started
        </Button>
      </section>

      <SiteFooter />
    </div>
  );
}
