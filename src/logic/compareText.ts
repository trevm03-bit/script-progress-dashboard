// Renders a RunComparison as plain Markdown. PURE, so it is testable and so the same text can be
// pasted into a ticket or an email without any of it depending on the editor.
import { RunComparison } from './compare';
import { formatDuration, dateTime } from './time';

function pct(n: number | null): string {
  if (n === null || !isFinite(n)) return '';
  const s = n > 0 ? '+' : '';
  return ` (${s}${n.toFixed(1)}%)`;
}

function val(v: number | string | undefined): string {
  if (v === undefined) return '—';
  return typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v);
}

export function comparisonText(c: RunComparison): string {
  const L: string[] = [];
  const a = c.a, b = c.b;
  L.push(`# ${c.sameTask ? a.task : `${a.task} → ${b.task}`}`);
  L.push('');
  L.push(`| | Baseline | Compared |`);
  L.push(`|---|---|---|`);
  L.push(`| Run | ${dateTime(a.date)} | ${dateTime(b.date)} |`);
  L.push(`| Outcome | ${a.success ? 'OK' : 'FAILED'}${a.category ? ` (${a.category})` : ''} | ${b.success ? 'OK' : 'FAILED'}${b.category ? ` (${b.category})` : ''} |`);
  L.push(`| Duration | ${formatDuration(Number(a.elapsed) || 0)} | ${formatDuration(Number(b.elapsed) || 0)}${c.durationDelta ? ` — ${c.durationDelta > 0 ? 'slower' : 'faster'} by ${formatDuration(Math.abs(c.durationDelta))}${pct(c.durationPct)}` : ''} |`);
  L.push(`| Warnings | ${a.warnings ?? 0} | ${b.warnings ?? 0} |`);
  L.push('');

  if (!c.bIsNewer) L.push('> Note: the compared run is the OLDER of the two, so "changed" reads backwards in time.');
  if (!c.sameTask) L.push('> Note: these are different scripts, so metrics with the same name may not mean the same thing.');
  if (!c.bIsNewer || !c.sameTask) L.push('');

  if (c.outcomeChanged) {
    L.push(b.success ? '**This run recovered** — the baseline failed and this one succeeded.' : '**This run broke** — the baseline succeeded and this one failed.');
    L.push('');
  }

  if (c.metrics.length) {
    L.push('## Metrics');
    L.push('');
    L.push('| Metric | Baseline | Compared | Change |');
    L.push('|---|---|---|---|');
    for (const m of c.metrics) {
      const change = m.direction === 'new' ? 'new this run'
        : m.direction === 'gone' ? 'not reported this run'
        : m.delta === null ? (m.direction === 'same' ? 'unchanged' : 'changed')
        : m.delta === 0 ? 'unchanged'
        : `${m.delta > 0 ? '+' : ''}${Math.round(m.delta * 1e6) / 1e6}${pct(m.pct)}`;
      L.push(`| ${m.key} | ${val(m.a)} | ${val(m.b)} | ${change} |`);
    }
    L.push('');
  } else {
    L.push('_Neither run reported any metrics._');
    L.push('');
  }

  const w = c.warnings;
  L.push('## Warnings');
  L.push('');
  if (!w.added.length && !w.resolved.length && !w.unchanged.length) {
    L.push('_Neither run recorded a warning._');
  } else {
    if (w.added.length) { L.push(`**New (${w.added.length})**`); L.push(''); for (const m of w.added) L.push(`- ${m}`); L.push(''); }
    if (w.resolved.length) { L.push(`**Gone (${w.resolved.length})**`); L.push(''); for (const m of w.resolved) L.push(`- ${m}`); L.push(''); }
    if (w.unchanged.length) { L.push(`**Still there (${w.unchanged.length})**`); L.push(''); for (const m of w.unchanged) L.push(`- ${m}`); L.push(''); }
  }

  if (c.touchedAdded.length || c.touchedRemoved.length) {
    L.push('## Touched');
    L.push('');
    for (const id of c.touchedAdded) L.push(`- \`+\` ${id}`);
    for (const id of c.touchedRemoved) L.push(`- \`−\` ${id} (not this run)`);
    L.push('');
  }

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
