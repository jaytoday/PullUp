export function ago(date: Date | null | undefined, now = Date.now()): string {
  if (!date) return "";
  const s = Math.round((now - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export const dollars = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
export const percent = (n: number) => `${Math.round(n * 100)}%`;
export const shortSha = (sha: string) => sha.slice(0, 7);
