export interface NavItem {
  label: string;
  icon: string;
  href: string;
}

export const MAIN_ITEMS: readonly NavItem[] = [
  { label: "Overview", icon: "i-lucide-layout-dashboard", href: "/overview" },
  { label: "Runs", icon: "i-lucide-list-checks", href: "/runs" },
  { label: "Questions", icon: "i-lucide-message-circle-question", href: "/questions" },
  { label: "Accuracy", icon: "i-lucide-target", href: "/accuracy" },
];

export const ACCOUNT_ITEMS: readonly NavItem[] = [
  { label: "Set up a repo", icon: "i-lucide-circle-plus", href: "/setup" },
  { label: "Settings", icon: "i-lucide-settings", href: "/settings" },
];

export function isActiveHref(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
