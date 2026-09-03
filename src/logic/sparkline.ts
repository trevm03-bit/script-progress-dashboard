// Delta Tracker maths: turn a series of numbers into an SVG path and a few stats.

export interface SeriesStats {
  current: number;
  first: number;
  min: number;
  max: number;
  /** current - first */
  change: number;
  trend: 'up' | 'down' | 'flat';
}

export function seriesStats(values: number[]): SeriesStats | null {
  const v = values.filter(n => typeof n === 'number' && isFinite(n));
  if (v.length === 0) return null;
  const current = v[v.length - 1];
  const first = v[0];
  const min = Math.min(...v);
  const max = Math.max(...v);
  const change = current - first;
  const span = max - min;
  // "flat" when the movement is negligible relative to the range (or the range itself is zero)
  const trend: SeriesStats['trend'] = span === 0 || Math.abs(change) < span * 0.02 ? 'flat' : change > 0 ? 'up' : 'down';
  return { current, first, min, max, change, trend };
}

/**
 * SVG path ("M x,y L x,y ...") for the values scaled into a w×h box with `pad` px margin.
 * A single point draws as a short flat line so the chart is never empty.
 */
export function sparklinePath(values: number[], w: number, h: number, pad = 2): string {
  const v = values.filter(n => typeof n === 'number' && isFinite(n));
  if (v.length === 0) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const pts = v.map((val, i) => {
    const x = v.length === 1 ? pad + innerW / 2 : pad + (i / (v.length - 1)) * innerW;
    const y = pad + innerH - ((val - min) / span) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  if (pts.length === 1) {
    const [x, y] = pts[0].split(',').map(Number);
    return `M ${(x - 4).toFixed(1)},${y} L ${(x + 4).toFixed(1)},${y}`;
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' ')}`;
}

/** Compact number for a metric card: 1234.5 -> "1,234.5", 0.00 -> "0", 15200000 -> "15.2M". */
export function formatMetric(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
