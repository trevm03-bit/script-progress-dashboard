// Dev-only: renders the three webview surfaces (panel, sidebar, map) as plain HTML pages under
// .harness/ so they can be opened in an ordinary browser — same CSS, same page scripts, same
// data files — with a stub in place of acquireVsCodeApi(). Two modes:
//
//   node scripts/harness.js [logsDir]            write static pages, serve them with any server
//   ... add --problems to inject malformed-settings warnings, the one state you cannot reach
//       from data files alone (it comes from configuration, not from the logs folder).
//   node scripts/harness.js --serve [port] [logsDir]
//       a tiny live server (default 8765): the pages re-fetch a freshly rendered payload every
//       second, so a `python demo/fake_run.py` in another terminal animates the browser exactly
//       the way the extension would — running bars, traffic particles, touched flashes and all.
//
// Open http://localhost:8765/.harness/panel.html. Not shipped (scripts/ is in .vscodeignore).
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const repo = path.resolve(__dirname, '..');
const { DataReader } = require(path.join(repo, 'out/dataReader.js'));
const { renderSections } = require(path.join(repo, 'out/render/dashboard.js'));
const { mapMarkup } = require(path.join(repo, 'out/render/map.js'));
const { buildGraph } = require(path.join(repo, 'out/logic/graph.js'));
const { parseIso, taskState } = require(path.join(repo, 'out/logic/time.js'));
const { settings } = require(path.join(repo, 'test/fixtures/settings.js'));

const args = process.argv.slice(2);
const serve = args.includes('--serve');
const withProblems = args.includes('--problems');
const rest = args.filter(a => a !== '--serve' && a !== '--problems');
const port = serve && /^\d+$/.test(rest[0] || '') ? Number(rest.shift()) : 8765;
const logsDir = rest[0] ? path.resolve(rest[0]) : path.join(repo, 'demo', 'logs');
const outDir = path.join(repo, '.harness');
fs.mkdirSync(outDir, { recursive: true });

const reader = new DataReader(logsDir);
const s = settings({
  timeline: { windowHours: 168 },
  problems: withProblems ? [
    { area: 'quickActions', index: 2, label: 'Nightly load', message: 'needs a "command" — the shell command to run.' },
    { area: 'processCalendar', index: 1, label: 'Close', message: 'is monthly but has no "dayOfMonth", so it can never be overdue.' },
    { area: 'deltaTracker', label: 'drift', message: 'has a threshold but is not in "deltaTracker.metrics", so it is never charted or checked.' },
  ] : [],
  processes: [
    { name: 'Demo Pipeline', label: 'Demo', frequency: 'daily', maxMinutes: 1 },
    { name: 'Nightly', label: 'Nightly', frequency: 'daily' },
    { name: 'Weekly Rollup', label: 'Weekly', frequency: 'weekly' },
    // A multi-phase process and one nothing has ever reported: the two states you cannot
    // produce from the demo log files alone.
    { name: 'Quarter Close', label: 'Quarter Close', frequency: 'monthly', dayOfMonth: 25,
      subtasks: ['Quarter Close Phase 1', 'Quarter Close Phase 2', 'Quarter Close Phase 3'] },
    { name: 'Never Wired', label: 'Never Wired', frequency: 'daily' },
  ],
});
s.accessMap.starfield = false;

const THEMES = {
  dark: `--vscode-font-family:system-ui,"Segoe UI",sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Consolas,monospace;
  --vscode-foreground:#cccccc;--vscode-editor-background:#1f1f1f;--vscode-sideBar-background:#181818;--vscode-editorWidget-background:#202020;
  --vscode-editorWidget-border:#313131;--vscode-panel-border:#2b2b2b;--vscode-descriptionForeground:#9d9d9d;--vscode-focusBorder:#0078d4;
  --vscode-badge-background:#616161;--vscode-badge-foreground:#f8f8f8;--vscode-progressBar-background:#0078d4;--vscode-testing-iconPassed:#73c991;
  --vscode-testing-iconFailed:#f14c4c;--vscode-editorWarning-foreground:#cca700;--vscode-charts-green:#89d185;--vscode-charts-red:#f14c4c;
  --vscode-charts-blue:#3794ff;--vscode-charts-orange:#d18616;--vscode-charts-purple:#b180d7;--vscode-charts-yellow:#cca700;
  --vscode-inputValidation-warningBackground:#352a05;--vscode-inputValidation-infoBackground:#063b49;--vscode-editorInfo-foreground:#3794ff;
  --vscode-list-hoverBackground:#2a2d2e;--vscode-textCodeBlock-background:#2b2b2b;--vscode-textLink-foreground:#4daafc;--vscode-textLink-activeForeground:#4daafc;
  --vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#026ec1;--vscode-input-background:#313131;
  --vscode-input-foreground:#ccc;--vscode-input-border:#3c3c3c;--vscode-dropdown-background:#313131;--vscode-dropdown-foreground:#ccc;--vscode-dropdown-border:#3c3c3c;
  --vscode-icon-foreground:#ccc;--vscode-toolbar-hoverBackground:#5a5d5e50;--vscode-editorHoverWidget-background:#202020;--vscode-editorHoverWidget-foreground:#ccc;
  --vscode-editorHoverWidget-border:#454545;--vscode-menu-background:#1f1f1f;--vscode-menu-foreground:#ccc;--vscode-menu-border:#454545;--vscode-menu-selectionBackground:#0078d4;
  --vscode-menu-selectionForeground:#fff;--vscode-editor-selectionBackground:#264f78;--vscode-sideBarTitle-foreground:#ccc;`,
  light: `--vscode-font-family:system-ui,"Segoe UI",sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Consolas,monospace;
  --vscode-foreground:#3b3b3b;--vscode-editor-background:#ffffff;--vscode-sideBar-background:#f8f8f8;--vscode-editorWidget-background:#f8f8f8;
  --vscode-editorWidget-border:#e5e5e5;--vscode-panel-border:#e5e5e5;--vscode-descriptionForeground:#717171;--vscode-focusBorder:#005fb8;
  --vscode-badge-background:#cccccc;--vscode-badge-foreground:#3b3b3b;--vscode-progressBar-background:#005fb8;--vscode-testing-iconPassed:#388a34;
  --vscode-testing-iconFailed:#e51400;--vscode-editorWarning-foreground:#bf8803;--vscode-charts-green:#388a34;--vscode-charts-red:#e51400;
  --vscode-charts-blue:#005fb8;--vscode-charts-orange:#d18616;--vscode-charts-purple:#652d90;--vscode-charts-yellow:#bf8803;
  --vscode-inputValidation-warningBackground:#f6f5d2;--vscode-inputValidation-infoBackground:#d6ecf2;--vscode-editorInfo-foreground:#1a85ff;
  --vscode-list-hoverBackground:#f2f2f2;--vscode-textCodeBlock-background:#f5f5f5;--vscode-textLink-foreground:#005fb8;--vscode-textLink-activeForeground:#005fb8;
  --vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#0258a8;--vscode-input-background:#fff;
  --vscode-input-foreground:#3b3b3b;--vscode-input-border:#cecece;--vscode-dropdown-background:#fff;--vscode-dropdown-foreground:#3b3b3b;--vscode-dropdown-border:#cecece;
  --vscode-icon-foreground:#3b3b3b;--vscode-toolbar-hoverBackground:#b8b8b850;--vscode-editorHoverWidget-background:#f8f8f8;--vscode-editorHoverWidget-foreground:#3b3b3b;
  --vscode-editorHoverWidget-border:#c8c8c8;--vscode-menu-background:#fff;--vscode-menu-foreground:#3b3b3b;--vscode-menu-border:#cecece;--vscode-menu-selectionBackground:#005fb8;
  --vscode-menu-selectionForeground:#fff;--vscode-editor-selectionBackground:#add6ff;--vscode-sideBarTitle-foreground:#3b3b3b;`,
};

/** What the extension host would post for one surface, from the files as they are right now. */
function payload(surface) {
  const data = reader.readAll();
  // In live mode "now" is real time; in static mode pretend it is just after the newest record,
  // so time windows have something in them however old the demo files are.
  let now = new Date();
  if (!serve) {
    const newest = Math.max(0, ...data.history.map(r => parseIso(r.date)?.getTime() ?? 0), ...data.tasks.map(t => parseIso(t.updatedAt)?.getTime() ?? 0));
    if (newest) now = new Date(newest + 5 * 60 * 1000);
  }
  const graph = buildGraph(data.access, data.tasks, s.accessMap.maxNodes, s.accessMap.timeWindowDays, now);
  const sections = surface === 'map' ? undefined : renderSections(data, s, { now, surface, trusted: true, collapsed: [], graph });
  const state = taskState(data.progress, s.staleRunningMinutes, now, data.overlays);
  const running = data.tasks.filter(t => taskState(t, s.staleRunningMinutes, now, data.overlays) === 'running').length;
  const sorted = data.history.slice().sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
  const recentRuns = sorted.filter(r => (r.accessed || []).length).slice(0, 8).map(r => ({ task: r.task, date: r.date, accessed: r.accessed }));
  return {
    type: 'update', sections, graph, replay: null, collapsed: [], state,
    status: { state, running, text: running ? `${running} running` : state === 'complete' ? 'idle · last run ok' : state, updated: now.toTimeString().slice(0, 5), logsDir },
    mapOptions: { layout: s.accessMap.layout, labels: s.accessMap.labels, timeWindowDays: 0, ambient: true, halos: true, glyphs: true, minimap: true, starfield: s.accessMap.starfield, recentRuns },
    density: 'comfortable', collapsible: true,
  };
}

function page(surface, theme) {
  const title = surface === 'map' ? 'Access Map' : surface === 'panel' ? 'Script Progress Dashboard' : 'Script Progress';
  const mapShell = surface === 'map' ? `<section class="card card-map map-only" data-section="accessMap">${mapMarkup(true)}</section>` : '';
  const tool = (msg, ic, t) => `<button class="icon-btn" data-msg="${msg}" title="${t}"><i class="codicon codicon-${ic}"></i></button>`;
  const tools = surface === 'sidebar'
    ? tool('openPanel', 'link-external', 'Open as editor tab') + tool('refresh', 'refresh', 'Refresh now') + tool('sections', 'checklist', 'Choose sections')
    : surface === 'panel'
      ? tool('copySummary', 'clippy', 'Copy daily summary') + tool('exportReport', 'file-pdf', 'Export report') + tool('openMap', 'graph', 'Open the Access Map') + tool('refresh', 'refresh', 'Refresh') + tool('sections', 'checklist', 'Sections') + tool('openLogs', 'folder-opened', 'Logs') + tool('settings', 'settings-gear', 'Settings')
      : tool('openPanel', 'dashboard', 'Open the dashboard') + tool('settings', 'settings-gear', 'Settings');
  const json = JSON.stringify(payload(surface)).replace(/<\//g, '<\\/');
  const live = serve
    ? `setInterval(function(){fetch('/payload/${surface}').then(function(r){return r.json()}).then(function(p){window.postMessage(p,'*')}).catch(function(){})},1000);`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="../media/codicons/codicon.css"><link rel="stylesheet" href="../media/dashboard.css">
<link rel="stylesheet" href="../media/sections/timeline.css"><link rel="stylesheet" href="../media/sections/metrics.css"><link rel="stylesheet" href="../media/sections/warningTrends.css">
<style>:root{${THEMES[theme]}} html{background:var(--vscode-editor-background)}</style><title>${title} (harness)</title></head>
<body class="surface-${surface} density-comfortable">
<header class="dash-head"><div class="brand"><svg class="brand-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><polyline points="2 12 6 12 9 5 13 19 16 12 22 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><h2>${title}</h2><span class="status-pill" id="status-pill" data-state="idle"><i class="dot"></i><span class="pill-text">…</span></span></div><div class="dash-tools"><span class="updated" id="updated"></span>${tools}</div></header>
<main id="sections">${mapShell || '<div class="empty">Loading…</div>'}</main>
<script>window.__errors=[];window.addEventListener('error',function(e){window.__errors.push([e.filename,e.lineno,e.colno,e.message].join(' '));});window.__posted=[];window.acquireVsCodeApi=function(){var st=null;return{postMessage:function(m){window.__posted.push(m);console.log('post',JSON.stringify(m).slice(0,200));},getState:function(){return st;},setState:function(v){st=v;}};};</script>
<script src="../media/accessMap.js"></script><script src="../media/dashboard.js"></script>
<script>window.__payload=${json};setTimeout(function(){window.postMessage(window.__payload,'*');},30);${live}</script>
</body></html>`;
}

function writePages() {
  for (const surface of ['panel', 'sidebar', 'map']) {
    for (const theme of ['dark', 'light']) {
      fs.writeFileSync(path.join(outDir, `${surface}${theme === 'dark' ? '' : '-light'}.html`), page(surface, theme));
    }
  }
  const data = reader.readAll();
  console.log(`harness written to ${outDir} from ${logsDir} (${data.history.length} runs, ${data.tasks.length} task slots${serve ? ', live' : ''})`);
}

writePages();

if (serve) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = /^\/payload\/(panel|sidebar|map)$/.exec(url.pathname);
    if (m) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(payload(m[1])));
      return;
    }
    const file = path.join(repo, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!file.startsWith(repo) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`live harness on http://localhost:${port}/.harness/panel.html — run demo/fake_run.py to see it move`));
}
