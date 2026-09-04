// Impact Summary: what the runs have added up to, rather than where the numbers stand now.
//
// The Delta Tracker answers "what is it currently?"; this answers "what have these scripts
// contributed since they were wired up?". Both come from the scripts' own reports, which is
// exactly why the section says so on its face — see the footer note.
import { DashboardData, Settings } from '../types';
import { impactTotals } from '../logic/compliance';
import { formatMetric } from '../logic/sparkline';
import { relativeTime } from '../logic/time';
import { esc, icon, section, empty, SectionOpts } from './html';

export function renderImpact(data: DashboardData, settings: Settings, now: Date, opts: SectionOpts): string {
  const totals = impactTotals(data.impact, now, data.history);
  if (!totals.length) {
    return section('impact', 'Impact Summary',
      empty('Nothing recorded yet. Scripts add to this with Progress.impact("name", value) — a contribution to accumulate, as opposed to a current value to chart.',
            { msg: 'walkthrough', label: 'Getting started', icon: 'book' }), opts);
  }

  // 24 cards is already a wall; beyond that the section stops being a summary.
  const MAX_CARDS = 24;
  const hidden = Math.max(0, totals.length - MAX_CARDS);
  const cards = totals.slice(0, MAX_CARDS).map(t => {
    const fmt = settings.deltas.formats?.[t.metric];
    // An unrenderable total (an overflow) must not then claim a monthly figure it cannot show.
    const showMonth = isFinite(t.thisMonth) && t.thisMonth !== 0 && isFinite(t.total);
    const period = showMonth
      ? `<div class="imp-sub">${esc(formatMetric(t.thisMonth, fmt))} <span class="muted">this month</span></div>`
      : '<div class="imp-sub muted">nothing this month</div>';
    return `<div class="imp-card">
  <div class="imp-label" title="${esc(t.metric)}">${esc(t.label)}</div>
  <div class="imp-total">${esc(formatMetric(t.total, fmt))}<span class="imp-unit"> total</span></div>
  ${t.thisMonth === t.total ? '' : period}
  <div class="imp-meta muted small">across ${t.runs} run${t.runs === 1 ? '' : 's'} · last ${esc(relativeTime(t.last, now))}</div>
</div>`;
  }).join('');

  // 🔴 This note is not decoration. A total like this is self-reported by the scripts that
  // produced it, under whatever definition their author chose, and it is exactly the kind of
  // number that gets quoted without its definition. Saying so here is cheaper than defending it
  // later.
  const foot = `<div class="muted small imp-foot">${icon('info')}<span>Totals are what your scripts reported, using their own definition of each measure.</span></div>`;

  const more = hidden ? `<div class="muted small list-more">${icon('ellipsis')} ${hidden} more measure${hidden === 1 ? '' : 's'} not shown.</div>` : '';
  return section('impact', 'Impact Summary', `<div class="imp-grid">${cards}</div>${more}${foot}`, opts);
}
