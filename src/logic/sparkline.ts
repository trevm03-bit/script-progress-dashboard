// Delta Tracker maths: turn a series of numbers into an SVG path and a few stats; format values;
// evaluate thresholds.
import { DeltaFormat, DeltaPoint, DeltaThreshold } from '../types';

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

/** y coordinate (same scaling as sparklinePath) for a horizontal guide line, or null when off-chart. */
export function sparklineY(values: number[], value: number, h: number, pad = 2): number | null {
  const v = values.filter(n => typeof n === 'number' && isFinite(n));
  if (v.length === 0 || !isFinite(value)) return null;
  const min = Math.min(...v, value);
  const max = Math.max(...v, value);
  const span = max - min || 1;
  const innerH = h - pad * 2;
  return pad + innerH - ((value - min) / span) * innerH;
}

/** Compact number for a metric card: 1234.5 -> "1,234.5", 0.00 -> "0", 15200000 -> "15.2M". */
/** Symbols that precede the number rather than following it. */
const CURRENCY = new Set(['$', '£', '€', '¥', '₹', '₽', '₩', 'R$', 'C$', 'A$']);

export function formatMetric(n: number, fmt?: DeltaFormat): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  let s: string;
  if (fmt && typeof fmt.decimals === 'number') {
    s = n.toLocaleString('en-US', { minimumFractionDigits: fmt.decimals, maximumFractionDigits: fmt.decimals });
  } else {
    const abs = Math.abs(n);
    if (abs >= 1e9) s = (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    else if (abs >= 1e6) s = (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    else if (abs >= 1e4) s = (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    else if (Number.isInteger(n)) s = n.toLocaleString('en-US');
    else s = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (fmt?.unit) {
    if (CURRENCY.has(fmt.unit)) {
      // A currency symbol goes BEFORE the digits and AFTER the sign: -$25,984.76, never
      // -25,984.76$ (and never -$25,984.76$, which is what suffixing a already-prefixed value
      // produced). Only the symbol moves; everything else formats as before.
      s = s.startsWith('-') ? `-${fmt.unit}${s.slice(1)}` : `${fmt.unit}${s}`;
    } else {
      s = fmt.unit === '%' || fmt.unit.length <= 1 ? s + fmt.unit : `${s} ${fmt.unit}`;
    }
  }
  return s;
}

/** true when the value breaks a configured threshold. */
export function outOfRange(value: number, t?: DeltaThreshold): boolean {
  if (!t || typeof value !== 'number' || !isFinite(value)) return false;
  if (typeof t.min === 'number' && value < t.min) return true;
  if (typeof t.max === 'number' && value > t.max) return true;
  return false;
}

/**
 * Points that came from the SAME run, i.e. a value a script found and the value it left behind
 * after fixing it. Without this the chart draws two unrelated dots and the story — "found this
 * much, resolved it to that" — is lost, which is the whole point of measuring twice.
 *
 * Only runs that reported more than one point are returned, newest run first.
 */
export function withinRunPairs(points: DeltaPoint[]): { runId: string; task: string; first: DeltaPoint; last: DeltaPoint; change: number }[] {
  const byRun = new Map<string, DeltaPoint[]>();
  for (const p of points) {
    if (!p.runId) continue;              // older reporters did not record it; nothing to pair
    const list = byRun.get(p.runId);
    if (list) list.push(p); else byRun.set(p.runId, [p]);
  }
  const out = [];
  for (const [runId, list] of byRun) {
    if (list.length < 2) continue;
    const first = list[0];
    const last = list[list.length - 1];
    out.push({ runId, task: last.task, first, last, change: last.value - first.value });
  }
  return out.reverse();                  // deltas.json is oldest first
}
