"use client";

import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { TopNav } from "@astryxdesign/core/TopNav";

export const NAV = [
  { href: "/runs", label: "Runs", icon: "▤" },
  { href: "/decisions", label: "Decisions", icon: "◇" },
  { href: "/reviews", label: "Reviews", icon: "◎" },
  { href: "/quality", label: "Quality", icon: "▲" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function PullUpShell({ email, demo, children }: { email: string; demo: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const signOut = async () => {
    await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    router.push("/login");
  };
  const sideNav = (
    <SideNav header={<SideNavHeading heading="PullUp" headingHref="/runs" subheading="CI decision agent" />} footer={<Text type="supporting" color="secondary">Decisions by AskWithAI</Text>} collapsible>
      <SideNavSection title="PullUp" data-testid="app-nav">
        {NAV.map((n) => (
          <SideNavItem key={n.href} label={n.label} icon={<span aria-hidden>{n.icon}</span>} href={n.href} isSelected={pathname === n.href || pathname.startsWith(`${n.href}/`)} />
        ))}
      </SideNavSection>
    </SideNav>
  );
  const topNav = (
    <TopNav
      label="PullUp"
      endContent={
        <HStack gap={2} vAlign="center">
          {demo && <Badge variant="warning" label="DEMO MODE · SYNTHETIC DATA" data-testid="demo-badge" />}
          <Text type="supporting" color="secondary">
            {email}
          </Text>
          <Button label="Sign out" variant="ghost" size="sm" onClick={signOut} />
        </HStack>
      }
    />
  );
  return (
    <>
      <AppShell sideNav={sideNav} topNav={topNav} mobileNav={{ hasToggle: true, content: sideNav }} contentPadding={4}>
        {children}
      </AppShell>
      <ToastViewport />
    </>
  );
}
