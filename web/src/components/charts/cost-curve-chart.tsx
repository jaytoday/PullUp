import { createMemo, createSignal, For, Show } from "solid-js";
import type { CostCurvePoint } from "@/lib/api";
import { hours, num } from "@/lib/format";
import { niceTicks, useWidth } from "./use-width";

const PAD = { top: 12, right: 14, bottom: 26, left: 40 };

const SERIES = [
  { key: "D", label: "Waiting cost D(w)", stroke: "var(--clay)" },
  { key: "E", label: "Defect cost E(w)", stroke: "var(--band-review)" },
  { key: "F", label: "Total F(w)", stroke: "var(--primary)" },
] as const;

/**
 * The two-cost model for one PR, from the engine's own curve: waiting cost D,
 * expected defect cost E, total F. Markers: current wait, w* (F's minimum), and
 * the active-mode w* when viewing in shadow mode.
 */
export function CostCurveChart(props: {
  points: readonly CostCurvePoint[];
  wait: number;
  wStar: number;
  shadowWStar?: number;
  height?: number;
}) {
  const [width, ref] = useWidth(560);
  const h = () => props.height ?? 220;
  const [hover, setHover] = createSignal<CostCurvePoint | null>(null);

  const maxW = createMemo(() => props.points.at(-1)?.w ?? 1);
  const maxY = createMemo(() => Math.max(1, ...props.points.map((p) => Math.max(p.F, p.D, p.E))) * 1.08);
  const x = (w: number) => PAD.left + (Math.min(w, maxW()) / maxW()) * (width() - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / maxY()) * (h() - PAD.top - PAD.bottom);
  const path = (key: "D" | "E" | "F") =>
    props.points.map((p, i) => `${i ? "L" : "M"}${x(p.w).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");

  const onMove = (e: MouseEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const w = ((e.clientX - rect.left - PAD.left) / (width() - PAD.left - PAD.right)) * maxW();
    let best = props.points[0] ?? null;
    for (const p of props.points) if (best && Math.abs(p.w - w) < Math.abs(best.w - w)) best = p;
    setHover(best);
  };

  const Marker = (m: { at: number; label: string; class: string; dashed?: boolean }) => (
    <Show when={m.at <= maxW()}>
      <g>
        <line
          x1={x(m.at)}
          x2={x(m.at)}
          y1={PAD.top}
          y2={h() - PAD.bottom}
          class={m.class}
          stroke="currentColor"
          stroke-width="1.25"
          stroke-dasharray={m.dashed ? "3 3" : undefined}
        />
        <text x={x(m.at) + 4} y={PAD.top + 9} class={`${m.class} num`} fill="currentColor" font-size="10">
          {m.label}
        </text>
      </g>
    </Show>
  );

  return (
    <div class="space-y-2">
      <div ref={ref} class="relative w-full">
        <svg
          width={width()}
          height={h()}
          role="img"
          aria-label={`Cost curves; w* at ${hours(props.wStar)}, current wait ${hours(props.wait)}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <For each={niceTicks(maxY())}>
            {(t) => (
              <g>
                <line x1={PAD.left} x2={width() - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" stroke-width="1" />
                <text x={PAD.left - 6} y={y(t) + 3} text-anchor="end" font-size="10" fill="var(--muted-foreground)" class="num">
                  {t}
                </text>
              </g>
            )}
          </For>
          <For each={niceTicks(maxW(), 5)}>
            {(t) => (
              <text x={x(t)} y={h() - 8} text-anchor="middle" font-size="10" fill="var(--muted-foreground)" class="num">
                {hours(t, 0)}
              </text>
            )}
          </For>
          <For each={SERIES}>
            {(s) => (
              <path
                d={path(s.key)}
                fill="none"
                stroke={s.stroke}
                stroke-width={s.key === "F" ? 2.25 : 1.5}
                stroke-linejoin="round"
                opacity={s.key === "F" ? 1 : 0.85}
              />
            )}
          </For>
          <Marker at={props.wait} label="now" class="text-foreground/70" dashed />
          <Show when={props.shadowWStar !== undefined && props.shadowWStar !== props.wStar}>
            <Marker at={props.shadowWStar!} label="active w*" class="text-band-review" dashed />
          </Show>
          <Marker at={props.wStar} label="w*" class="text-primary" />
          <Show when={hover()}>
            {(p) => (
              <g pointer-events="none">
                <line x1={x(p().w)} x2={x(p().w)} y1={PAD.top} y2={h() - PAD.bottom} stroke="var(--muted-foreground)" stroke-opacity="0.5" />
                <For each={SERIES}>{(s) => <circle cx={x(p().w)} cy={y(p()[s.key])} r="3" fill={s.stroke} />}</For>
              </g>
            )}
          </Show>
        </svg>
        <Show when={hover()}>
          {(p) => (
            <div
              class="pointer-events-none absolute top-2 rounded-md border border-border bg-popover/95 px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${Math.min(x(p().w) + 10, width() - 150)}px` }}
            >
              <div class="num mb-1 text-muted-foreground">w = {hours(p().w)}</div>
              <For each={SERIES}>
                {(s) => (
                  <div class="flex items-center justify-between gap-4">
                    <span class="flex items-center gap-1.5">
                      <span class="size-2 rounded-full" style={{ background: s.stroke }} />
                      {s.key}
                    </span>
                    <span class="num">{num(p()[s.key], 2)}</span>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <For each={SERIES}>
          {(s) => (
            <span class="flex items-center gap-1.5">
              <span class="h-0.5 w-3 rounded" style={{ background: s.stroke }} />
              {s.label}
            </span>
          )}
        </For>
        <span>· dev-hours</span>
      </div>
    </div>
  );
}
