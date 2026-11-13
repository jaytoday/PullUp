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
    title: "Something tricky → AskWithAI",
    description: "A flaky test, weakened tests or a change to sign-in code goes to a configured Decision Runtime. PullUp verifies its citations and applies the repository's fixed rules.",
    className: "md:col-span-1",
  },
];

const FEATURES = [
  { title: "Code decides what is tricky", description: "A fixed list of triggers, not the AI, decides which runs need judgment. Target: under 15% of runs.", icon: "i-lucide-scan-search" },
  { title: "Quotes are checked", description: "A runtime's fail counts only if its citation really appears in the changed code, log or report.", icon: "i-lucide-badge-check" },
  { title: "A person for the hard cases", description: "Sign-in code, migrations, payments and secrets go to the person you name, by email, phone, a button or a comment.", icon: "i-lucide-user-check" },
  { title: "Bounded waiting", description: "A deadline and a reminder, then your rule: fail, follow the runtime answer, pass, or ask a backup.", icon: "i-lucide-hourglass" },
  { title: "Shadow mode first", description: "A neutral check shows what PullUp would decide, so you can trust it before it blocks anything.", icon: "i-lucide-eye" },
  { title: "Config from the default branch", description: "A pull request can never loosen its own checks.", icon: "i-lucide-lock" },
  { title: "Every call on the record", description: "Each GitHub call needs a single-use permit, and every step goes on a hash-chained record.", icon: "i-lucide-scroll-text" },
  { title: "Outcomes improve decisions", description: "Real human rulings are sent back to the matching AskWithAI runtime question for evaluation.", icon: "i-lucide-brain" },
];

const STEP = "rounded-lg bg-muted p-4 text-sm text-body ring ring-border";

const FLOW = [
  { title: "Collect", content: <p key="step-1" className={STEP}>When every required workflow has finished for a commit, PullUp reads the job results (with reruns), the end of each failed log and the pull request&apos;s diff. Its rules come from <code className="font-mono">.pullup/config.json</code> on the default branch.</p> },
  { title: "Decide what is tricky", content: <p key="step-2" className={STEP}>A hard failure fails at once. Otherwise each trigger looks for something that needs judgment: a test that passed only on rerun, tests skipped or deleted, a change under sign-in, migrations, payments, secrets or CI configuration. No trigger, no AI: the run passes.</p> },
  { title: "Send to AskWithAI", content: <p key="step-3" className={STEP}>For each question, PullUp sends bounded repository and CI context to a pinned AskWithAI Decision Runtime. It returns pass, fail or needs a person, with a probability and supporting citations.</p> },
  { title: "Apply PullUp's rules", content: <p key="step-4" className={STEP}>PullUp checks citations against the original evidence. A fail without a verified quote needs a person. Strong passes count only when the trigger allows the runtime to pass it.</p> },
  { title: "Record outcomes", content: <p key="step-5" className={STEP}>The result, runtime receipt and every GitHub call are kept on a hash-chained record. Real human rulings are reported to AskWithAI for evaluation.</p> },
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
          <Badge color="primary" variant="soft" className="mb-5">A CI decision system, built on AskWithAI</Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-6xl">CI that knows when to ask</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-balance text-muted-foreground sm:text-lg">
            PullUp owns the software-engineering context and merge rules. AskWithAI runs the versioned decisions for changes that need judgment. PullUp checks the evidence and brings in a person when needed.
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
        <p className="mx-auto mb-10 max-w-xl text-center text-sm text-muted-foreground">PullUp's code handles routine cases. AskWithAI only sees questions that need judgment.</p>
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
