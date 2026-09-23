import { For, Show, createSignal } from "solid-js";
import { niceTicks, useWidth } from "./use-width";

/** Small area/line chart over an ordered series (e.g. daily queue depth). */
export function AreaChart(props: {
  points: ReadonlyArray<{ x: string; y: number }>;
  height?: number;
  format?: (y: number) => string;
  reference?: number;
}) {
  const [width, ref] = useWidth(480);
  const h = () => props.height ?? 140;
  const PAD = { l: 30, r: 8, t: 8, b: 20 };
  const [hover, setHover] = createSignal<number | null>(null);
  const maxY = () => Math.max(1e-9, ...props.points.map((p) => p.y), props.reference ?? 0) * 1.1;
  const x = (i: number) => PAD.l + (i / Math.max(1, props.points.length - 1)) * (width() - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / maxY()) * (h() - PAD.t - PAD.b);
  const line = () => props.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  const area = () => `${line()}L${x(props.points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const fmt = (v: number) => (props.format ? props.format(v) : String(v));

  return (
    <div ref={ref} class="relative w-full">
      <svg
        width={width()}
        height={h()}
        role="img"
        aria-label="Trend chart"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - PAD.l) / (width() - PAD.l - PAD.r)) * (props.points.length - 1));
          setHover(Math.max(0, Math.min(props.points.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.28" />
            <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <For each={niceTicks(maxY(), 3)}>
          {(t) => (
            <g>
              <line x1={PAD.l} x2={width() - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--border)" />
              <text x={PAD.l - 5} y={y(t) + 3} text-anchor="end" font-size="9.5" fill="var(--muted-foreground)" class="num">
                {t}
              </text>
            </g>
          )}
        </For>
        <Show when={props.reference !== undefined}>
          <line x1={PAD.l} x2={width() - PAD.r} y1={y(props.reference!)} y2={y(props.reference!)} stroke="var(--clay)" stroke-dasharray="3 3" />
        </Show>
        <Show when={props.points.length > 1}>
          <path d={area()} fill="url(#area-fill)" />
          <path d={line()} fill="none" stroke="var(--primary)" stroke-width="1.5" />
        </Show>
        <Show when={props.points.length > 0}>
          <text x={PAD.l} y={h() - 4} font-size="9.5" fill="var(--muted-foreground)" class="num">
            {props.points[0]!.x}
          </text>
          <text x={width() - PAD.r} y={h() - 4} text-anchor="end" font-size="9.5" fill="var(--muted-foreground)" class="num">
            {props.points.at(-1)!.x}
          </text>
        </Show>
        <Show when={hover() !== null}>
          <circle cx={x(hover()!)} cy={y(props.points[hover()!]!.y)} r="3.5" fill="var(--primary)" />
        </Show>
      </svg>
      <Show when={hover() !== null}>
        <div class="pointer-events-none absolute top-0 rounded-md border border-border bg-popover/95 px-2 py-1 text-xs shadow-lg" style={{ left: `${Math.min(x(hover()!) + 8, width() - 120)}px` }}>
          <span class="num text-muted-foreground">{props.points[hover()!]!.x}</span> <span class="num">{fmt(props.points[hover()!]!.y)}</span>
        </div>
      </Show>
    </div>
  );
}
