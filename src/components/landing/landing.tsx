"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

const STEPS = [
  { title: "1. Same answers, now recorded", body: "Point PullUp's Jev base address at its AskWithAI runtime. Answers do not change; every decision gets a receipt and can be measured." },
  { title: "2. Watch in shadow", body: "Switch the runtime to shadow. Callers still get the same answers; AskWithAI records what routing would have answered and what it would cost." },
  { title: "3. Go active", body: "Routine cases get cheap answers; a reasoning model or a reviewer looks only where a wrong \"safe\" would be expensive." },
];

export function Landing() {
  return (
    <div className="page">
      <VStack gap={6}>
        <VStack gap={3}>
          <Text type="code" color="accent">
            PULLUP // CI DECISION AGENT
          </Text>
          <Heading level={1}>A CI check that knows when to ask</Heading>
          <Text color="secondary">
            After your CI finishes, PullUp fails real breakage and passes routine changes with plain code. When something needs judgment (a test that passed only on a retry, deleted tests, a change to sign-in code) its agent gathers the evidence and asks a decision runtime. Code applies a fixed rule to the typed answer, and a reviewer decides when it matters.
          </Text>
          <div>
            <Button label="Sign in" variant="primary" href="/login" />
          </div>
        </VStack>
        <Grid columns={{ minWidth: 260 }} gap={3}>
          {STEPS.map((s) => (
            <Card key={s.title} padding={5}>
              <VStack gap={2}>
                <Heading level={3}>{s.title}</Heading>
                <Text color="secondary">{s.body}</Text>
              </VStack>
            </Card>
          ))}
        </Grid>
        <Text type="supporting" color="secondary">
          The adoption runbook is docs/adopting-askwithai.md in PullUp&apos;s repository.
        </Text>
      </VStack>
    </div>
  );
}
