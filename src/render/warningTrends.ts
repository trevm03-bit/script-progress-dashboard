// Warning Trends: a per-day bar chart of warning volume, then the messages that repeat most —
// grouped by shape rather than by exact text, so "12 rows had no id" and "28 rows had no id"
// are one line with a count instead of two rows of noise.
import { DashboardData, Settings } from '../types';
import { WarningGroup, warningTrendsModel } from '../logic/warningTrends';
import { relativeTime } from '../logic/time';
import { chip, esc, icon, empty, section, SectionOpts } from './html';

const CHART_W = 280;
const CHART_H = 44;
const GAP = 2;

const TREND_ICON: Record<WarningGroup['trend'], string> = { rising: 'arrow-up', falling: 'arrow-down', flat: 'arrow-right' };
const TREND_LABEL: Record<WarningGroup['trend'], string> = {
  rising: 'more often than earlier in the window',
  falling: 'less often than earlier in the window',
  flat: 'about as often as earlier in the window',
};

/** Bars for the per-day counts; the most recent day is highlighted. */
function chart(days: { date: string; label: string; count: number }[]): string {
  const max = Math.max(1, ...days.map(d => d.count));
  const slot = CHART_W / days.length;
  const barW = Math.max(1, slot - GAP);
  const bars = days.map((d, i) => {
    const h = d.count === 0 ? 0 : Math.max(2, (d.count / max) * (CHART_H - 4));
    const x = i * slot + (slot - barW) / 2;
    const y = CHART_H - h;
    const cls = `wt-bar${i === days.length - 1 ? ' wt-bar-last' : ''}${d.count === 0 ? ' wt-bar-zero' : ''}`;
    const title = `${d.date}: ${d.count} warning${d.count === 1 ? '' : 's'}`;
    // A zero day still gets a hairline so the axis reads as continuous and stays hoverable.
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${(d.count === 0 ? CHART_H - 1 : y).toFixed(1)}" width="${barW.toFixed(1)}" height="${(d.count === 0 ? 1 : h).toFixed(1)}"><title>${esc(title)}</title></rect>`;
  }).join('');
  const first = days[0];
  const mid = days[Math.floor((days.length - 1) / 2)];
  const last = days[days.length - 1];
  const labels = days.length > 2 && mid !== first && mid !== last
    ? [first, mid, last]
    : [first, last].filter((d, i, a) => a.indexOf(d) === i);
  return `<svg class="wt-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" role="img" aria-label="Warnings per day">${bars}</svg>
<div class="wt-days muted small">${labels.map(d => `<span>${esc(d.label)}</span>`).join('')}</div>`;
}

function group(g: WarningGroup, now: Date): string {
  const tasks = g.tasks.map(t => chip('task', t, 'wt-task')).join('');
  return `<li class="wt-group">
  <span class="wt-count" title="${g.count} occurrence${g.count === 1 ? '' : 's'} in this window">${g.count}</span>
  <div class="wt-body">
    <div class="wt-msg" title="${esc(g.pattern)}">${esc(g.example)}</div>
    <div class="wt-meta muted small">
      <span class="wt-tasks">${tasks}</span>
      <span class="wt-when">first ${esc(relativeTime(g.firstSeen, now))} · last ${esc(relativeTime(g.lastSeen, now))}</span>
      <span class="wt-trend wt-${g.trend}" title="${esc(TREND_LABEL[g.trend])}">${icon(TREND_ICON[g.trend])}${g.trend}</span>
    </div>
  </div>
</li>`;
}

export function renderWarningTrends(
  data: DashboardData,
  settings: Settings,
  now: Date,
  opts: SectionOpts,
  narrow: boolean,
): string {
  const model = warningTrendsModel(data, settings, now);
  if (model.total === 0) {
    const body = empty(`No warnings in the last ${model.windowDays} day${model.windowDays === 1 ? '' : 's'}.`);
    return section('warningTrends', 'Warning Trends', body, opts);
  }

  const groups = narrow ? model.groups.slice(0, 3) : model.groups;
  const body = `${narrow ? '' : chart(model.days)}
<ul class="wt-list">${groups.map(g => group(g, now)).join('')}</ul>`;

  const aside = `${model.total} in ${model.windowDays} day${model.windowDays === 1 ? '' : 's'}`;
  return section('warningTrends', 'Warning Trends', body, { ...opts, aside });
}
