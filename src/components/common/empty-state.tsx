"use client";

import { useTheme } from "next-themes";
import SpotlightCard from "@/components/effects/spotlight-card";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { useThemeColor } from "@/components/effects/theme-color";

/** An empty state with the next step, on React Bits' SpotlightCard (a soft light follows the pointer; still with reduced motion). */
export function EmptyState({ icon, title, description, action }: { icon: string; title: string; description: string; action?: { href: string; label: string } }) {
  const { resolvedTheme } = useTheme();
  const primary = useThemeColor("--primary");
  return (
    <SpotlightCard theme={resolvedTheme === "dark" ? "dark" : "light"} spotlightColor={primary ?? undefined} className="rounded-lg" data-effect="spotlight-card">
      <Empty icon={icon} title={title} description={description} className="border-none" actions={action ? <Button href={action.href} color="primary" size="sm">{action.label}</Button> : undefined} />
    </SpotlightCard>
  );
}
