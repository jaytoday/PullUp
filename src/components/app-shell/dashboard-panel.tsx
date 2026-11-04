"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ColorModeButton } from "./color-mode-button";
import { UserMenu } from "./user-menu";

/** A page inside the app shell: a header with the title, page actions and the account menu, over a scrolling body. */
export function DashboardPanel({ title, actions, children }: { title?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-1.5">
          <SidebarTrigger className="md:hidden" />
          {typeof title === "string" ? <h1 className="truncate font-semibold text-foreground">{title}</h1> : title}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <UserMenu />
          <ColorModeButton />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}

/** A centered page column. */
export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6", className)}>{children}</div>;
}
