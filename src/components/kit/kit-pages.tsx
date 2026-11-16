"use client";

import { VStack } from "@astryxdesign/core/Stack";
import { DecisionFeed, QualityPanel, ReviewQueue, ServingModeControl, ShadowComparison } from "@askwithai/react";
import { KitGate } from "./kit-gate";

/** The web kit screens, wrapped so they explain themselves when AskWithAI is not connected. */
export function DecisionsScreen({ runtime }: { runtime: string | null }) {
  return <KitGate ready={!!runtime}>{runtime && <DecisionFeed runtime={runtime} limit={200} />}</KitGate>;
}

export function ReviewsScreen({ runtime }: { runtime: string | null }) {
  return <KitGate ready={!!runtime}>{runtime && <ReviewQueue runtime={runtime} />}</KitGate>;
}

export function QualityScreen({ runtime }: { runtime: string | null }) {
  return (
    <KitGate ready={!!runtime}>
      {runtime && (
        <VStack gap={5}>
          <ServingModeControl runtime={runtime} />
          <QualityPanel runtime={runtime} />
          <ShadowComparison runtime={runtime} />
        </VStack>
      )}
    </KitGate>
  );
}
