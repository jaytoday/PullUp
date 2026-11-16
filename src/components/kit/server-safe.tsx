"use client";

import { Heading as AxHeading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

/** A page heading with one line of explanation, usable from server pages. */
export function Heading({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <VStack gap={1}>
        <AxHeading level={1}>{title}</AxHeading>
        {description && <Text color="secondary">{description}</Text>}
      </VStack>
    </div>
  );
}
