// Display formatting — hours, dev-hours, percentages, relative times. Numbers
// render in the mono face (`.num`) at the call site.

export function hours(h: number | null | undefined, digits = 1): string {
  if (h === null || h === undefined || Number.isNaN(h)) return "—";
  if (h >= 48) return `${(h / 24).toFixed(h >= 240 ? 0 : 1)}d`;
  return `${h.toFixed(h >= 10 ? 0 : digits)}h`;
}

export function devHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  return `${h.toFixed(h >= 100 ? 0 : 1)} dev-h`;
}

export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function prob(p: number | null | undefined): string {
  if (p === null || p === undefined) return "—";
  return p.toFixed(2);
}

export function usd(x: number): string {
  if (x === 0) return "$0";
  if (x < 0.01) return `$${x.toFixed(4)}`;
  return `$${x.toFixed(2)}`;
}

export function num(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined) return "—";
  return x.toFixed(digits);
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "touchesAuthn" → "Touches authn". */
export function humanize(id: string): string {
  const words = id.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
