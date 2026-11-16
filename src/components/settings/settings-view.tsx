"use client";

import { useTransition } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { ConnectionStatus } from "@/server/connection";
import { setCheckMode } from "@/app/(app)/settings/actions";

const PROVIDER = { jev: "Jev (System One)", gemini: "Gemini Decisions API", askwithai: "AskWithAI SDK" } as const;

export function SettingsView({ status, repos }: { status: ConnectionStatus; repos: Array<{ fullName: string; checkMode: "report_only" | "enforce"; synthetic: boolean }> }) {
  const [pending, start] = useTransition();
  return (
    <VStack gap={5}>
      <Card padding={5} data-testid="connection">
        <VStack gap={3}>
          <HStack gap={2} vAlign="center">
            <Heading level={2}>Decision provider</Heading>
            {status.viaAskWithAI ? <Badge variant="success" label="THROUGH ASKWITHAI" /> : <Badge variant="neutral" label="DIRECT" />}
          </HStack>
          <MetadataList>
            <MetadataListItem label="Provider (PULLUP_DECIDER)">{PROVIDER[status.decider]}</MetadataListItem>
            <MetadataListItem label="Base address">
              <Text type="code">{status.baseUrl}</Text>
            </MetadataListItem>
            <MetadataListItem label="Key">{status.keySet ? "set (not shown)" : "missing"}</MetadataListItem>
            <MetadataListItem label="AskWithAI runtime (PULLUP_RUNTIME)">{status.runtime ?? "not set"}</MetadataListItem>
            <MetadataListItem label="Agent">{status.harness === "scripted" ? "scripted planner (no model)" : status.harness}</MetadataListItem>
            <MetadataListItem label="Last call">{status.lastCall ? `${new Date(status.lastCall.at).toLocaleString()} · ${status.lastCall.provider} · ${status.lastCall.status}` : "none yet"}</MetadataListItem>
          </MetadataList>
          <Text type="supporting" color="secondary">
            The serving mode (parity, shadow, active) is switched in AskWithAI, or on the Quality page. Keys are read from the server&apos;s environment and never sent to the browser.
          </Text>
        </VStack>
      </Card>
      <VStack gap={3}>
        <Heading level={2}>Repositories</Heading>
        {!repos.length && <EmptyState title="No repositories yet" description="A repository appears when PullUp first sees a finished workflow on it." />}
        {repos.map((r) => (
          <Card key={r.fullName} padding={4} data-testid={`repo-${r.fullName}`}>
            <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
              <HStack gap={2} vAlign="center">
                <Text type="code">{r.fullName}</Text>
                {r.synthetic && <Badge variant="warning" label="SYNTHETIC" />}
              </HStack>
              <SegmentedControl label={`Check mode for ${r.fullName}`} value={r.checkMode} onChange={(v) => start(() => setCheckMode(r.fullName, v as "report_only" | "enforce"))}>
                <SegmentedControlItem value="report_only" label="Report only" />
                <SegmentedControlItem value="enforce" label="Enforce" />
              </SegmentedControl>
            </HStack>
            <Text type="supporting" color="secondary">
              {r.checkMode === "enforce" ? "The check passes, fails, or stays in progress for a person. Simulated answers never pass." : "The check is always neutral and says what PullUp would do."}
              {pending ? " Saving…" : ""}
            </Text>
          </Card>
        ))}
        <Text type="supporting" color="secondary">
          Required workflows, the known-flaky list, sensitive paths and reviewers live in each repository&apos;s .pullup/config.json on the default branch, so a pull request cannot loosen its own checks.
        </Text>
      </VStack>
    </VStack>
  );
}
