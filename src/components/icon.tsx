import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Brain,
  Check,
  Circle,
  CircleAlert,
  CirclePlus,
  Eye,
  GitBranch,
  Hourglass,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Lock,
  LogOut,
  MessageCircleQuestion,
  Minus,
  Moon,
  OctagonX,
  ScanSearch,
  ScrollText,
  Settings,
  Sun,
  Target,
  UserCheck,
  UserRound,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * String-named icons (`i-lucide-<name>`), so icon names can travel as data
 * (nav items, feature lists). Add an entry here when a new name is needed.
 * Adapted from code/theory's icon map, trimmed to the icons PullUp uses.
 */
const LUCIDE: Record<string, LucideIcon> = {
  "arrow-right": ArrowRight,
  "arrow-up-right": ArrowUpRight,
  "badge-check": BadgeCheck,
  "brain": Brain,
  "check": Check,
  "circle": Circle,
  "circle-alert": CircleAlert,
  "circle-plus": CirclePlus,
  "eye": Eye,
  "git-branch": GitBranch,
  "hourglass": Hourglass,
  "inbox": Inbox,
  "layout-dashboard": LayoutDashboard,
  "list-checks": ListChecks,
  "loader-circle": LoaderCircle,
  "lock": Lock,
  "log-out": LogOut,
  "message-circle-question": MessageCircleQuestion,
  "minus": Minus,
  "moon": Moon,
  "octagon-x": OctagonX,
  "scan-search": ScanSearch,
  "scroll-text": ScrollText,
  "settings": Settings,
  "sun": Sun,
  "target": Target,
  "user-check": UserCheck,
  "user-round": UserRound,
  "users": Users,
  "workflow": Workflow,
  "x": X,
};

export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  /** `i-lucide-<name>`, or a bare lucide name. */
  name: string;
};

export function Icon({ name, className, ...props }: IconProps) {
  const key = name.startsWith("i-lucide-") ? name.slice("i-lucide-".length) : name;
  const Lucide = LUCIDE[key] ?? LUCIDE.circle!;
  return <Lucide aria-hidden="true" className={cn("inline-block size-4 shrink-0", className)} {...props} />;
}
