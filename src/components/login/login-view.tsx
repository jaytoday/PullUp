"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ColorModeButton } from "@/components/app-shell/color-mode-button";
import { DotPattern } from "@/components/effects/dot-pattern";
import { Icon } from "@/components/icon";
import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const OUTCOMES = [
  { icon: "i-lucide-x", label: "Hard failure → fail, no AI" },
  { icon: "i-lucide-check", label: "Nothing tricky → pass, no AI" },
  { icon: "i-lucide-users", label: "Something tricky → the council" },
  { icon: "i-lucide-message-circle-question", label: "Still unclear → a person" },
];

/** Sign in, or create the first account (sign-up closes after that). */
export function LoginView({ headline }: { headline: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const redirectParam = searchParams.get("redirect");
  const redirectTo = redirectParam?.startsWith("/") && !redirectParam.startsWith("//") ? redirectParam : "/overview";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = mode === "sign-up" ? await authClient.signUp.email({ email, password, name: name || email.split("@")[0] || "Owner" }) : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? (mode === "sign-up" ? "Sign up failed." : "Sign in failed."));
        return;
      }
      router.push(mode === "sign-up" ? "/setup" : redirectTo);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background text-body lg:flex-row">
      <section className="flex flex-1 items-center justify-center border-b px-4 py-10 lg:border-e lg:border-b-0 lg:px-12 lg:py-8">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <h2 className="text-lg font-semibold text-foreground">{mode === "sign-in" ? "Sign in" : "Create the owner account"}</h2>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              {mode === "sign-up" ? (
                <FormField label="Name" htmlFor="name">
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" />
                </FormField>
              ) : null}
              <FormField label="Email" htmlFor="email">
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="you@example.com" />
              </FormField>
              <FormField label="Password" htmlFor="password">
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} required minLength={8} placeholder="At least 8 characters" />
              </FormField>
              {error ? <p className="text-sm text-error" role="alert">{error}</p> : null}
              <Button type="submit" block color="primary" loading={loading}>
                {mode === "sign-in" ? "Sign in" : "Create account"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center">
            <button type="button" className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
              {mode === "sign-in" ? "First time here? Create the owner account" : "Already have an account? Sign in"}
            </button>
          </CardFooter>
        </Card>
      </section>

      <section className="relative isolate flex flex-1 flex-col px-4 py-6 sm:px-8 lg:px-12 lg:py-8">
        <DotPattern className="-z-10 text-border mask-[radial-gradient(ellipse_at_center,white,transparent_75%)]" />
        <header className="flex items-center justify-between">
          <Link href="/">
            <Wordmark />
          </Link>
          <ColorModeButton />
        </header>
        <div className="flex flex-1 flex-col justify-center py-10 lg:py-16">
          <div className="max-w-lg space-y-6">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{headline}</h1>
              <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">Code decides what is tricky. A council of AI reviewers answers through WithAI. A person settles the rest, and everything is on the record.</p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {OUTCOMES.map((item) => (
                <li key={item.label} className="flex items-center gap-1.5 text-xs text-toned">
                  <Icon name={item.icon} className="size-3.5 shrink-0" />
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
