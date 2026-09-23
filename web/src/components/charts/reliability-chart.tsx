import { For } from "solid-js";
import type { CalibrationArtifact } from "@/lib/api";
import { pct } from "@/lib/format";

type Bin = CalibrationArtifact["metrics"]["reliability"][number];

/**
 * Reliability diagram: mean predicted vs observed defect rate per bin, dot
 * area ∝ bin size. Points on the diagonal are perfectly calibrated.
 */
export function ReliabilityChart(props: { bins: readonly Bin[]; size?: number }) {
  const S = () => props.size ?? 260;
  const P = 30;
  const inner = () => S() - P - 10;
  const x = (v: number) => P + v * inner();
  const y = (v: number) => 10 + (1 - v) * inner();
  const filled = () => props.bins.filter((b) => b.n > 0 && b.meanPredicted !== null && b.observedRate !== null);
  const maxN = () => Math.max(1, ...filled().map((b) => b.n));
  return (
    <svg width={S()} height={S()} role="img" aria-label="Reliability diagram: predicted vs observed defect rate">
      <For each={[0, 0.25, 0.5, 0.75, 1]}>
        {(t) => (
          <g>
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={P - 5} y={y(t) + 3} text-anchor="end" font-size="9.5" fill="var(--muted-foreground)" class="num">
              {t}
            </text>
            <text x={x(t)} y={S() - 2} text-anchor="middle" font-size="9.5" fill="var(--muted-foreground)" class="num">
              {t}
            </text>
          </g>
        )}
      </For>
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--muted-foreground)" stroke-dasharray="4 4" stroke-opacity="0.6" />
      <polyline
        fill="none"
        stroke="var(--primary)"
        stroke-width="1.5"
        points={filled()
          .map((b) => `${x(b.meanPredicted!)},${y(b.observedRate!)}`)
          .join(" ")}
      />
      <For each={filled()}>
        {(b) => (
          <circle cx={x(b.meanPredicted!)} cy={y(b.observedRate!)} r={3 + 7 * Math.sqrt(b.n / maxN())} fill="var(--primary)" fill-opacity="0.35" stroke="var(--primary)">
            <title>{`predicted ${pct(b.meanPredicted)} · observed ${pct(b.observedRate)} · n=${b.n}`}</title>
          </circle>
        )}
      </For>
    </svg>
  );
}
