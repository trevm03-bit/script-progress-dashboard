// A short, self-contained HTML digest — the thing you actually paste into an email.
//
// Deliberately NOT the full report: this is what someone who was not watching needs, in the
// length they will read. Inline styles only, because every mail client strips <style> blocks and
// nothing here may depend on a stylesheet surviving the journey.
import { DashboardData, RunRecord, Settings } from '../types';
import { calendarRows } from './calendar';
import { coverage, impactTotals, pendingActions } from './compliance';
import { failurePatterns, patternText } from './failures';
import { formatMetric } from './sparkline';
import { formatDuration, parseIso } from './time';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A conservative, light-only palette: a mail client may render on any background, and a dark
// theme's colours are unreadable on the white one most of them use.
const INK = '#1f2328', MUTED = '#57606a', LINE = '#d0d7de';
const OK = '#1a7f37', BAD = '#cf222e', WARN = '#9a6700';

export function digestHtml(data: DashboardData, settings: Settings, now: Date, days = 7): string {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const runs = data.history
    .filter(r => { const d = parseIso(r.date); return !!d && d >= from; })
    .sort((a, b) => (parseIso(a.date)?.getTime() ?? 0) - (parseIso(b.date)?.getTime() ?? 0));
  const failed = runs.filter(r => !r.success);
  const warnings = runs.reduce((n, r) => n + (r.warnings || 0), 0);
  const rows = calendarRows(settings.processes, data.history, now);
  const overdue = rows.filter(r => r.status === 'overdue');
  const blocked = rows.filter(r => r.status === 'blocked');
  const day = (d: Date) => `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;

  const P: string[] = [];
  P.push(`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:${INK};max-width:760px">`);
  P.push(`<h2 style="margin:0 0 4px;font-size:18px">Script activity — ${esc(day(from))} to ${esc(day(now))}</h2>`);

  const cov = coverage(rows, data.history, 0, 0, now);
  if (cov.percent !== null) {
    P.push(`<p style="margin:0 0 14px;color:${MUTED};font-size:13px">Coverage ${cov.percent}% — ${esc(cov.inputs.map(i => i.detail).join(' · '))}</p>`);
  }

  P.push(row([
    stat(String(runs.length), 'runs'),
    stat(String(failed.length), 'failed', failed.length ? BAD : OK),
    stat(String(warnings), 'warnings', warnings ? WARN : MUTED),
    stat(String(overdue.length), 'overdue', overdue.length ? BAD : OK),
  ]));

  if (overdue.length || blocked.length) {
    P.push(`<p style="margin:12px 0 4px">`);
    if (overdue.length) P.push(`<b style="color:${BAD}">Overdue:</b> ${esc(overdue.map(r => r.process.label || r.process.name).join(', '))}<br>`);
    if (blocked.length) P.push(`<b style="color:${MUTED}">Waiting on something upstream:</b> ${esc(blocked.map(r => `${r.process.label || r.process.name} (${r.note})`).join('; '))}`);
    P.push(`</p>`);
  }

  const actions = pendingActions(data.history, now, settings.pendingActions.maxAgeDays);
  if (actions.length) {
    P.push(h3('Needs attention'));
    P.push(`<ul style="margin:0 0 12px;padding-left:20px">`);
    for (const a of actions.slice(0, 12)) {
      P.push(`<li style="margin:2px 0">${a.count !== undefined ? `<b>${esc(a.count)}</b> ` : ''}${esc(a.msg)} <span style="color:${MUTED}">— ${esc(a.task)}</span></li>`);
    }
    P.push(`</ul>`);
  }

  P.push(h3('By script'));
  const byTask = new Map<string, RunRecord[]>();
  for (const r of runs) { const l = byTask.get(r.task); if (l) l.push(r); else byTask.set(r.task, [r]); }
  if (byTask.size) {
    P.push(`<table style="border-collapse:collapse;width:100%;font-size:13px">`);
    P.push(`<tr>${['Script', 'Runs', 'Failed', 'Warnings', 'Typical'].map(h => `<th style="text-align:left;padding:5px 8px;border-bottom:1px solid ${LINE};color:${MUTED};font-weight:600">${h}</th>`).join('')}</tr>`);
    for (const [task, list] of Array.from(byTask.entries()).sort((a, b) => b[1].length - a[1].length)) {
      const bad = list.filter(r => !r.success).length;
      const avg = list.reduce((n, r) => n + (Number(r.elapsed) || 0), 0) / list.length;
      const warn = list.reduce((n, r) => n + (r.warnings || 0), 0);
      P.push(`<tr>
        <td style="padding:5px 8px;border-bottom:1px solid ${LINE}">${esc(task)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid ${LINE}">${list.length}</td>
        <td style="padding:5px 8px;border-bottom:1px solid ${LINE};color:${bad ? BAD : INK}">${bad}</td>
        <td style="padding:5px 8px;border-bottom:1px solid ${LINE};color:${warn ? WARN : INK}">${warn}</td>
        <td style="padding:5px 8px;border-bottom:1px solid ${LINE};color:${MUTED}">${esc(formatDuration(avg))}</td>
      </tr>`);
    }
    P.push(`</table>`);
  } else {
    P.push(`<p style="color:${MUTED}">Nothing ran in this window.</p>`);
  }

  const impact = impactTotals(data.impact, now);
  if (impact.length) {
    P.push(h3('Contributed'));
    P.push(`<ul style="margin:0 0 12px;padding-left:20px">`);
    for (const t of impact) {
      const fmt = settings.deltas.formats?.[t.metric];
      P.push(`<li style="margin:2px 0">${esc(t.label)}: <b>${esc(formatMetric(t.total, fmt))}</b> total, ${esc(formatMetric(t.thisMonth, fmt))} this month <span style="color:${MUTED}">(${t.runs} runs)</span></li>`);
    }
    P.push(`</ul>`);
  }

  if (failed.length) {
    P.push(h3('Failures'));
    P.push(`<ul style="margin:0 0 12px;padding-left:20px">`);
    for (const r of failed) {
      const d = parseIso(r.date);
      P.push(`<li style="margin:2px 0">${d ? esc(day(d)) + ' ' : ''}${esc(r.task)}${r.category ? ` <span style="color:${MUTED}">[${esc(r.category)}]</span>` : ''}${r.summary ? ` — ${esc(r.summary)}` : ''}</li>`);
    }
    P.push(`</ul>`);
    const pattern = patternText(failurePatterns(data.history, now, days, 20));
    if (pattern) P.push(`<p style="margin:0 0 12px;color:${WARN}"><b>Pattern:</b> ${esc(pattern)}</p>`);
  }

  P.push(`<p style="margin-top:16px;color:${MUTED};font-size:12px">Figures are what the scripts themselves reported.</p>`);
  P.push(`</div>`);
  return P.join('\n');
}

function h3(text: string): string {
  return `<h3 style="margin:16px 0 6px;font-size:14px;color:${INK}">${esc(text)}</h3>`;
}
function stat(value: string, label: string, color = INK): string {
  return `<td style="padding:8px 14px 8px 0"><div style="font-size:20px;font-weight:600;color:${color}">${esc(value)}</div><div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div></td>`;
}
function row(cells: string[]): string {
  return `<table style="border-collapse:collapse"><tr>${cells.join('')}</tr></table>`;
}
