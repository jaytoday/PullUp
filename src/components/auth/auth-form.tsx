"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";

/** Email and password. The first account owns this PullUp; after that sign-up is closed unless PULLUP_OPEN_SIGNUP=1. */
export function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(mode === "signup" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "signup" ? { name: email.split("@")[0], email, password } : { email, password }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? (mode === "signup" ? "Could not create the account." : "Wrong email or password."));
      router.push(params.get("redirect") ?? "/runs");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "80vh", padding: 16 }}>
      <Card padding={6} width="100%" maxWidth={420}>
        <form onSubmit={(e) => (e.preventDefault(), void submit())}>
          <VStack gap={4}>
            <Heading level={1}>PullUp</Heading>
            <SegmentedControl label="Account" value={mode} onChange={(v) => setMode(v as "login" | "signup")}>
              <SegmentedControlItem value="login" label="Sign in" />
              <SegmentedControlItem value="signup" label="Create account" />
            </SegmentedControl>
            <Text color="secondary">{mode === "signup" ? "The first account owns this PullUp." : "Welcome back."}</Text>
            {error && <Banner status="error" title={error} />}
            <TextInput label="Email" type="email" value={email} onChange={setEmail} isRequired htmlName="email" autoComplete="email" />
            <TextInput label="Password" type="password" value={password} onChange={setPassword} isRequired htmlName="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} description={mode === "signup" ? "At least 8 characters." : undefined} />
            <Button type="submit" label={mode === "signup" ? "Create account" : "Sign in"} variant="primary" isLoading={busy} width="100%" />
          </VStack>
        </form>
      </Card>
    </div>
  );
}
