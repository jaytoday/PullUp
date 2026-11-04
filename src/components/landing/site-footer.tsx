import Link from "next/link";
import { Wordmark } from "@/components/logo";

/** A plain footer. (Aceternity's footer blocks are Pro components this registry key cannot install.) */
export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="space-y-2">
          <Wordmark />
          <p className="max-w-xs text-sm text-muted-foreground">CI that fails what is broken, passes what is plain, and asks about the rest. Built on WithAI.</p>
        </div>
        <nav className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm" aria-label="Footer">
          <Link className="text-muted-foreground hover:text-foreground" href="/login">Sign in</Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/setup">Set up a repo</Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/overview">Dashboard</Link>
          <a className="text-muted-foreground hover:text-foreground" href="#how-it-works">How it works</a>
        </nav>
      </div>
    </footer>
  );
}
