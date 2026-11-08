/** One numeric coordinate system per round keeps proportional alternatives distinguishable. */
export type GraphScale = { lo: number; hi: number };
export const GRAPH_PLOT = { width: 200, height: 120, left: 32, right: 8, top: 12, bottom: 18 } as const;

export function graphRoundScale(curves: readonly (readonly number[])[]): GraphScale {
  let lo = 0, hi = 0;
  for (const curve of curves) for (const value of curve) {
    if (Number.isFinite(value)) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
  }
  return lo === hi ? { lo: -1, hi: 1 } : { lo, hi };
}

export function graphY(value: number, scale: GraphScale): number {
  const { height, top, bottom } = GRAPH_PLOT;
  // Normalizing first also avoids overflowing the span for large finite samples.
  const magnitude = Math.max(Math.abs(scale.lo), Math.abs(scale.hi), 1);
  const fraction = (value / magnitude - scale.lo / magnitude) / (scale.hi / magnitude - scale.lo / magnitude);
  return height - bottom - fraction * (height - top - bottom);
}

export function graphPlotPoints(values: readonly number[], scale: GraphScale): string {
  const { width, left, right } = GRAPH_PLOT;
  return values.map((value, i) => {
    const x = left + i * (width - left - right) / Math.max(1, values.length - 1);
    return `${x.toFixed(1)},${graphY(value, scale).toFixed(1)}`;
  }).join(' ');
}
