import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";

/** Tracks an element's content width (charts render in real pixels, no stretched text). */
export function useWidth(fallback = 600): [Accessor<number>, (el: HTMLElement) => void] {
  const [width, setWidth] = createSignal(fallback);
  let el: HTMLElement | undefined;
  onMount(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    setWidth(el.clientWidth || fallback);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.floor(w));
    });
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });
  return [width, (node) => (el = node)];
}

/** "Nice" axis ticks covering [0, max]. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}
