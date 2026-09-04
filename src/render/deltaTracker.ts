// Delta Tracker: one inline SVG sparkline per metric with current / min / max / trend, optional
// unit formatting and threshold bands.
import { DashboardData, Settings } from '../types';
import { formatMetric, outOfRange, seriesStats, sparklinePath, sparklineY } from '../logic/sparkline';
import { relativeTime } from '../logic/time';
import { esc, icon, section, empty, problemList, SectionOpts } from './html';
import { problemsFor } from '../logic/validate';

const W = 220;
const H = 48;

export function renderDeltaTracker(data: DashboardData, settings: Settings, now: Date, opts: SectionOpts): string {
  const available = Object.keys(data.deltas || {});
  const names = settings.deltaMetrics.length ? settings.deltaMetrics : available;
  const problems = problemsFor(settings.problems, 'deltaTracker');
  if (names.length === 0) return section('deltaTracker', 'Delta Tracker', problemList(problems) + empty('No metrics in deltas.json yet. Scripts add them with Progress.track_delta().'), opts);

  let outCount = 0;
  // A metric several tasks report (rows_loaded from two pipelines, say) is one card per task;
  // drawing them on one line would zigzag between two unrelated scales.
  const series: { name: string; task?: string }[] = [];
  for (const name of names) {
    const tasks = [...new Set((data.deltas[name] ?? []).map(p => p.task).filter((t): t is string => typeof t === 'string' && t.length > 0))];
    if (tasks.length > 1) for (const task of tasks.sort()) series.push({ name, task });
    else series.push({ name });
  }
  const cards = series.map(({ name, task }) => {
    const fmt = settings.deltas.formats[name];
    const thr = settings.deltas.thresholds[name];
    const label = (fmt?.label || name) + (task ? ` · ${task}` : '');
    const pts = (data.deltas[name] ?? []).filter(p => !task || p.task === task).slice(-settings.deltas.points);
    const values = pts.map(p => p.value);
    const stats = seriesStats(values);
    if (!stats) return `<div class="delta"><div class="delta-name">${esc(label)}</div>${empty('no data yet')}</div>`;
    const bad = outOfRange(stats.current, thr);
    if (bad) outCount++;
    const trendCls = bad ? 'trend-bad' : stats.trend === 'up' ? 'trend-up' : stats.trend === 'down' ? 'trend-down' : 'trend-flat';
    const trendIcon = stats.trend === 'up' ? 'arrow-up' : stats.trend === 'down' ? 'arrow-down' : 'arrow-right';
    const last = pts[pts.length - 1];
    // Threshold guides share the chart's scale (including the threshold values so they are always visible).
    const guideVals = [thr?.min, thr?.max].filter((v): v is number => typeof v === 'number');
    const scaleVals = values.concat(guideVals);
    const guides = guideVals.map(v => { const y = sparklineY(scaleVals, v, H, 3); return y === null ? '' : `<line class="guide" x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
    // When guides extend the scale, draw the path against the combined range so both agree.
    const pathScaled = guideVals.length ? rescaledPath(values, scaleVals, W, H, 3) : sparklinePath(values, W, H, 3);
    const lastX = values.length === 1 ? W / 2 : W - 3;
    const lastY = sparklineY(guideVals.length ? scaleVals : values, stats.current, H, 3) ?? H / 2;
    return `<div class="delta ${bad ? 'delta-bad' : ''}">
  <div class="delta-head"><span class="delta-name" title="${esc(task ? `${name} reported by ${task}` : name)}">${esc(fmt?.label || name)}${task ? `<span class="delta-task"> · ${esc(task)}</span>` : ''}</span><span class="delta-current ${trendCls}">${esc(formatMetric(stats.current, fmt))} ${icon(bad ? 'warning' : trendIcon)}</span></div>
  <svg class="sparkline-svg ${trendCls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${esc(label)} trend">
    ${guides}
    <path class="sparkline-area" d="${pathScaled} L ${lastX.toFixed(1)},${H} L 3,${H} Z"/>
    <path class="sparkline" d="${pathScaled}"/>
    <circle class="sparkline-dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5"/>
  </svg>
  <div class="delta-stats muted small">
    <span>min ${esc(formatMetric(stats.min, fmt))}</span><span>max ${esc(formatMetric(stats.max, fmt))}</span>
    <span>Δ ${stats.change >= 0 ? '+' : ''}${esc(formatMetric(stats.change, fmt))}</span>
    ${thr ? `<span title="Threshold">${typeof thr.min === 'number' ? `≥ ${esc(formatMetric(thr.min, fmt))}` : ''}${typeof thr.min === 'number' && typeof thr.max === 'number' ? ' · ' : ''}${typeof thr.max === 'number' ? `≤ ${esc(formatMetric(thr.max, fmt))}` : ''}</span>` : ''}
    <span>${pts.length} pts · ${esc(relativeTime(last?.date, now))}</span>
  </div>
</div>`;
  }).join('');

  const aside = outCount ? `<span class="status-fail">${outCount} out of range</span>` : '';
  return section('deltaTracker', 'Delta Tracker', problemList(problems) + `<div class="delta-grid">${cards}</div>`, { ...opts, aside });
}

/** Path for `values` drawn on the scale of `scaleVals` (which contains the values plus guides). */
function rescaledPath(values: number[], scaleVals: number[], w: number, h: number, pad: number): string {
  const min = Math.min(...scaleVals);
  const max = Math.max(...scaleVals);
  const span = max - min || 1;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const pts = values.map((val, i) => {
    const x = values.length === 1 ? pad + innerW / 2 : pad + (i / (values.length - 1)) * innerW;
    const y = pad + innerH - ((val - min) / span) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  if (pts.length === 1) { const [x, y] = pts[0].split(',').map(Number); return `M ${(x - 4).toFixed(1)},${y} L ${(x + 4).toFixed(1)},${y}`; }
  return `M ${pts[0]} L ${pts.slice(1).join(' ')}`;
}
