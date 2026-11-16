"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

/** One button per demo step, so the demo can be presented without a terminal. Development or PULLUP_DEMO=1 only. */
export function DemoControls() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const act = async (action: string, size?: number, split?: string) => {
    setBusy(`${action}${split ?? ""}`);
    try {
      const res = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, size, split }) });
      const body = (await res.json()) as Record<string, unknown>;
      setNote(res.ok ? JSON.stringify(body) : String((body.error as { message?: string })?.message ?? res.status));
      router.refresh();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card padding={4} data-testid="demo-controls">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <Text weight="semibold">Demo controls</Text>
          <Badge variant="warning" label="SYNTHETIC DATA" />
        </HStack>
        <Text type="supporting" color="secondary">
          Plays synthetic pull requests through the real pipeline on a fake GitHub. Outcomes come from the generator&apos;s ground truth and are marked synthetic.
        </Text>
        <HStack gap={2} wrap="wrap">
          <Button label="Play 10 pull requests" variant="primary" isLoading={busy === "play"} onClick={() => act("play", 10)} data-testid="demo-play" />
          <Button label="Play 20 hard ones" variant="secondary" isLoading={busy === "playhard"} onClick={() => act("play", 20, "hard")} data-testid="demo-play-hard" />
          <Button label="Check waiting runs" variant="secondary" isLoading={busy === "refresh"} onClick={() => act("refresh")} data-testid="demo-refresh" />
          <Button label="Report outcomes" variant="secondary" isLoading={busy === "outcomes"} onClick={() => act("outcomes")} data-testid="demo-outcomes" />
          <Button label="Start over" variant="ghost" isLoading={busy === "reset"} onClick={() => act("reset")} data-testid="demo-reset" />
        </HStack>
        {note && (
          <Text type="code" data-testid="demo-note">
            {note}
          </Text>
        )}
      </VStack>
    </Card>
  );
}
