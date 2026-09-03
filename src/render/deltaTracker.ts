// Delta Tracker: one inline SVG sparkline per metric with current / min / max / trend.
import { DashboardData, Settings } from '../types';
import { formatMetric, seriesStats, sparklinePath } from '../logic/sparkline';
import { relativeTime } from '../logic/time';
import { esc, icon, section, empty } from './html';

const W = 220;
const H = 44;

export function renderDeltaTracker(data: DashboardData, settings: Settings, now: Date): string {
  const available = Object.keys(data.deltas || {});
  const names = settings.deltaMetrics.length ? settings.deltaMetrics : available;
  if (names.length === 0) return section('deltaTracker', 'Delta Tracker', empty('No metrics in deltas.json yet. Scripts add them with Progress.track_delta().'));

  const cards = names
    .map(name => {
      const pts = data.deltas[name] ?? [];
      const values = pts.map(p => p.value);
      const stats = seriesStats(values);
      if (!stats) {
        return `<div class="delta"><div class="delta-name">${esc(name)}</div>${empty('no data yet')}</div>`;
      }
      const trendCls = stats.trend === 'up' ? 'trend-up' : stats.trend === 'down' ? 'trend-down' : 'trend-flat';
      const trendIcon = stats.trend === 'up' ? 'arrow-up' : stats.trend === 'down' ? 'arrow-down' : 'arrow-right';
      const last = pts[pts.length - 1];
      return `<div class="delta">
  <div class="delta-head"><span class="delta-name" title="${esc(name)}">${esc(name)}</span><span class="delta-current ${trendCls}">${esc(formatMetric(stats.current))} ${icon(trendIcon)}</span></div>
  <svg class="sparkline-svg ${trendCls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${esc(name)} trend">
    <path class="sparkline" d="${sparklinePath(values, W, H, 3)}"/>
  </svg>
  <div class="delta-stats muted small">
    <span>min ${esc(formatMetric(stats.min))}</span><span>max ${esc(formatMetric(stats.max))}</span>
    <span>Δ ${stats.change >= 0 ? '+' : ''}${esc(formatMetric(stats.change))}</span>
    <span>${pts.length} pts · ${esc(relativeTime(last?.date, now))}</span>
  </div>
</div>`;
    })
    .join('');

  return section('deltaTracker', 'Delta Tracker', `<div class="delta-grid">${cards}</div>`);
}
