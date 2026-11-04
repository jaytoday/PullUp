"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { ACCOUNT_ITEMS, isActiveHref, MAIN_ITEMS, type NavItem } from "./nav-items";

function NavLink({ item, pathname, badge }: { item: NavItem; pathname: string; badge?: number }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={item.label} isActive={isActiveHref(pathname, item.href)}>
        <Link href={item.href}>
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {badge ? <SidebarMenuBadge className="rounded-full bg-primary/15 text-primary">{badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  );
}

export function AppSidebar({ openQuestions, stopped }: { openQuestions: number; stopped: boolean }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);

  return (
    <Sidebar variant="inset" collapsible="icon" className="py-2">
      <SidebarHeader className="flex-row items-center group-data-[collapsible=icon]:justify-center">
        <Link href="/overview" aria-label="Overview" className="flex min-w-0 items-center gap-2 px-2.5 group-data-[collapsible=icon]:px-0">
          <Logo className="size-5 shrink-0 text-primary" />
          <span className="text-sm font-semibold tracking-tight text-foreground group-data-[collapsible=icon]:hidden">PullUp</span>
        </Link>
        <SidebarTrigger className="ms-auto group-data-[collapsible=icon]:hidden" />
      </SidebarHeader>
      <SidebarContent className="gap-0 px-2">
        <SidebarMenu data-testid="sidebar-main">
          {MAIN_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} badge={item.href === "/questions" ? openQuestions : undefined} />
          ))}
        </SidebarMenu>
        <SidebarGroup className="mt-3 px-0">
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarMenu>
            {ACCOUNT_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      {stopped ? (
        <SidebarFooter className="px-2 group-data-[collapsible=icon]:hidden">
          <Link href="/settings" className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
            <Icon name="i-lucide-octagon-x" />
            Stopped: nothing is posted to GitHub
          </Link>
        </SidebarFooter>
      ) : null}
      <SidebarRail />
    </Sidebar>
  );
}
