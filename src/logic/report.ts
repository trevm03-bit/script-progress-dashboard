// A self-contained HTML report: the dashboard's sections rendered with a neutral light/dark
// palette (no VS Code variables available outside the editor), plus a static SVG of the access
// map in the radial arrangement. Meant to be attached to a ticket or sent to a manager.
import { DashboardData, Settings } from '../types';
import { renderSections } from '../render/dashboard';
import { buildGraph } from './graph';
import { dateTime } from './time';
import { esc } from '../render/html';

const TYPE_COLOR: Record<string, string> = { task: '#3b82f6', table: '#a855f7', file: '#f59e0b', api: '#22c55e', other: '#eab308' };

/** Static radial SVG of the access graph. */
export function mapSvg(data: DashboardData, settings: Settings, now: Date, size = 640): string {
  const g = buildGraph(data.access, data.tasks, settings.accessMap.maxNodes, settings.accessMap.timeWindowDays, now);
  if (!g.nodes.length) return '';
  const c = size / 2;
  const tasks = g.nodes.filter(n => n.type === 'task').sort((a, b) => a.label.localeCompare(b.label));
  const res = g.nodes.filter(n => n.type !== 'task');
  const r1 = tasks.length === 1 ? 0 : Math.min(size * 0.16, 30 + tasks.length * 12);
  const r2 = size * 0.38;
  const pos = new Map<string, { x: number; y: number }>();
  tasks.forEach((n, i) => { const a = -Math.PI / 2 + (i / Math.max(1, tasks.length)) * Math.PI * 2; pos.set(n.id, { x: c + Math.cos(a) * r1, y: c + Math.sin(a) * r1 }); });
  // Anything that is not one of the four known types is grouped with "other" rather than left
  // without a position. access.json is a published, open contract: a hand-written or third-party
  // file using "queue", or simply "Table" with a capital T, previously reached the non-null
  // assertion below and killed the whole export with a TypeError.
  const order = ['table', 'file', 'api', 'other'];
  const known = new Set(order);
  const groups = order
    .map(t => res.filter(n => (known.has(n.type) ? n.type : 'other') === t).sort((a, b) => a.label.localeCompare(b.label)))
    .filter(x => x.length);
  const total = res.length || 1;
  let angle = -Math.PI / 2;
  const gap = groups.length > 1 ? 0.12 : 0;
  for (const grp of groups) {
    const span = (grp.length / total) * (Math.PI * 2 - gap * groups.length);
    grp.forEach((n, i) => { const a = angle + gap / 2 + ((i + 0.5) / grp.length) * span; pos.set(n.id, { x: c + Math.cos(a) * r2, y: c + Math.sin(a) * r2 }); });
    angle += span + gap;
  }
  const edges = g.edges.map(e => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return '';
    const w = 0.8 + Math.min(3, Math.log2(1 + (e.count || 1)));
    return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${e.mode === 'write' ? '#6b7280' : '#9ca3af'}" stroke-width="${w.toFixed(1)}" ${e.mode === 'read' ? 'stroke-dasharray="5 4"' : ''} opacity="0.6"/>`;
  }).join('');
  const nodes = g.nodes.map(n => {
    const p = pos.get(n.id);
    if (!p) return '';   // belt and braces: a node with no position is skipped, never crashed on
    const r = (n.type === 'task' ? 8 : 5) + Math.min(6, Math.sqrt(n.degree || 0) * 1.4);
    const right = p.x >= c;
    return `<g><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${TYPE_COLOR[n.type] || TYPE_COLOR.other}"/><text x="${(p.x + (right ? r + 5 : -(r + 5))).toFixed(1)}" y="${p.y.toFixed(1)}" font-size="11" text-anchor="${right ? 'start' : 'end'}" dominant-baseline="middle" fill="currentColor" ${n.type === 'task' ? 'font-weight="600"' : ''}>${esc(n.label)}</text></g>`;
  }).join('');
  const legend = Object.entries(TYPE_COLOR).filter(([t]) => g.nodes.some(n => n.type === t)).map(([t, col], i) => `<g transform="translate(${12 + i * 110}, ${size - 14})"><circle r="5" fill="${col}"/><text x="10" y="4" font-size="11" fill="currentColor">${t}</text></g>`).join('');
  return `<svg class="report-map" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Access map">${edges}${nodes}${legend}</svg>`;
}

export function reportHtml(data: DashboardData, settings: Settings, now: Date, title = 'Script Progress report'): string {
  // report.includeIdentity is honoured HERE, by handing the renderers a settings object with it
  // already applied. It was previously declared, documented in the README as gating the exported
  // report, and read by nothing at all - so the OS username and git commit went into every
  // exported file regardless, and report.ts even un-hid the row they sit in.
  const body = renderSections(data, {
    ...settings,
    dashboard: { ...settings.dashboard, collapsible: false },
    sections: { ...settings.sections, quickActions: false },
  }, { now, surface: 'panel', trusted: false, collapsed: [], identity: settings.report.includeIdentity !== false });
  const map = settings.sections.accessMap ? mapSvg(data, settings, now) : '';
  // Strip interactive-only bits: buttons that post messages, the live map markup.
  const cleaned = body
    .replace(/<section class="card card-map"[\s\S]*?<\/section>/g, map ? `<section class="card"><div class="section-title"><span class="section-name">Access Map</span></div>${map}</section>` : '')
    .replace(/<div class="filters">[\s\S]*?<\/div>\s*<\/div>/g, '')
    // [^>]* on BOTH sides: the Compare button carries data-key and title after data-msg, so the
    // old pattern skipped it - leaving a dead control, and its run id, in a file built to be sent
    // to someone else.
    .replace(/<button[^>]*\sdata-msg="[^"]*"[^>]*>[\s\S]*?<\/button>/g, '')
    .replace(/<button class="link-btn" data-open="([^"]*)"[^>]*>[\s\S]*?<\/button>/g, '<span class="mono">$1</span>')
    .replace(/<tr class="detail" hidden>/g, '<tr class="detail">');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark;
  --vscode-foreground:#1f2328; --vscode-editor-background:#ffffff; --vscode-editorWidget-background:#f6f8fa; --vscode-editorWidget-border:#d0d7de; --vscode-panel-border:#d0d7de;
  --vscode-descriptionForeground:#57606a; --vscode-focusBorder:#0969da; --vscode-badge-background:#ddf4ff; --vscode-badge-foreground:#0a3069;
  --vscode-testing-iconPassed:#1a7f37; --vscode-testing-iconFailed:#cf222e; --vscode-editorWarning-foreground:#9a6700; --vscode-progressBar-background:#0969da;
  --vscode-charts-green:#1a7f37; --vscode-charts-red:#cf222e; --vscode-charts-blue:#0969da; --vscode-charts-orange:#bc4c00; --vscode-charts-purple:#8250df; --vscode-charts-yellow:#9a6700;
  --vscode-inputValidation-warningBackground:#fff8c5; --vscode-inputValidation-infoBackground:#ddf4ff; --vscode-editorInfo-foreground:#0969da;
  --vscode-list-hoverBackground:#f6f8fa; --vscode-textCodeBlock-background:#f6f8fa; --vscode-textLink-foreground:#0969da; --vscode-editor-font-family:ui-monospace,Consolas,monospace;
  --vscode-font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; --vscode-font-size:13px; --vscode-button-background:#0969da; --vscode-button-foreground:#fff; }
@media (prefers-color-scheme: dark) { :root {
  --vscode-foreground:#e6edf3; --vscode-editor-background:#0d1117; --vscode-editorWidget-background:#161b22; --vscode-editorWidget-border:#30363d; --vscode-panel-border:#30363d;
  --vscode-descriptionForeground:#8b949e; --vscode-focusBorder:#58a6ff; --vscode-badge-background:#1f3a5f; --vscode-badge-foreground:#c9e2ff;
  --vscode-testing-iconPassed:#3fb950; --vscode-testing-iconFailed:#f85149; --vscode-editorWarning-foreground:#d29922; --vscode-progressBar-background:#58a6ff;
  --vscode-charts-green:#3fb950; --vscode-charts-red:#f85149; --vscode-charts-blue:#58a6ff; --vscode-charts-orange:#db6d28; --vscode-charts-purple:#a371f7; --vscode-charts-yellow:#d29922;
  --vscode-inputValidation-warningBackground:#3b2e00; --vscode-inputValidation-infoBackground:#0c2d6b; --vscode-editorInfo-foreground:#58a6ff;
  --vscode-list-hoverBackground:#161b22; --vscode-textCodeBlock-background:#161b22; --vscode-textLink-foreground:#58a6ff; } }
${'__DASHBOARD_CSS__'}
.codicon { display: none; }
body { padding: 24px; max-width: 1100px; margin: 0 auto; }
.report-head { margin-bottom: 18px; }
.report-head h1 { font-size: 20px; margin: 0 0 4px; }
.report-head .meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
.report-map { max-width: 100%; height: auto; display: block; margin: 8px auto; color: var(--vscode-foreground); }
tr.detail td { padding-left: 8px; }
</style></head>
<body>
<div class="report-head"><h1>${esc(title)}</h1><div class="meta">Generated ${esc(dateTime(now.toISOString()))} · from ${esc(data.logsDir)} · ${data.history.length} runs on record</div></div>
${cleaned}
<p class="meta muted small">Produced by Script Progress Dashboard for VS Code.</p>
</body></html>`;
}
