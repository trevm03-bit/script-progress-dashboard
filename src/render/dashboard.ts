// Assembles every enabled section into the HTML that goes inside the webview's #sections div,
// in the configured order, honouring the sidebar subset and collapsed state.
// Pure: no vscode import, so the whole page can be rendered in a test from fixture data.
import { DashboardData, SECTION_ICONS, SECTION_TITLES, SectionId, Settings, Surface } from '../types';
import { DrawGraph } from '../logic/graph';
import { renderSummary } from './summary';
import { renderActiveTask } from './activeTask';
import { renderWarnings } from './warnings';
import { renderLastCompleted } from './lastCompleted';
import { renderRunHistory } from './runHistory';
import { renderProcessCalendar } from './processCalendar';
import { renderQuickActions } from './quickActions';
import { renderDeltaTracker } from './deltaTracker';
import { renderScriptHealth } from './scriptHealth';
import { renderAccessMap } from './accessMapSummary';
import { renderTimeline } from './timeline';
import { renderMetricsExplorer } from './metricsExplorer';
import { renderWarningTrends } from './warningTrends';
import { renderPendingActions } from './pendingActions';
import { renderImpact } from './impact';
import { esc, icon, SectionOpts } from './html';

export interface RenderContext {
  now: Date;
  surface: Surface;
  trusted: boolean;
  collapsed?: SectionId[];
  /**
   * Whether run rows may name who ran the script and from which commit. Undefined means yes.
   * The exported report and the digest set it from `report.includeIdentity`, because those are
   * the artefacts that leave the machine - the live dashboard is for the person already sitting
   * in front of it and always shows what it knows.
   */
  identity?: boolean;
  /** Pre-built access graph (the host builds it once per refresh); the section builds its own if absent. */
  graph?: DrawGraph;
}

export function renderSections(data: DashboardData, settings: Settings, ctx: RenderContext): string {
  const parts: string[] = [];
  const narrow = ctx.surface === 'sidebar';
  const enabled = (id: SectionId) => settings.sections[id] && (!narrow || settings.sidebarSections.length === 0 || settings.sidebarSections.includes(id));
  const collapsed = new Set(ctx.collapsed ?? []);
  const o = (id: SectionId): SectionOpts => ({ collapsed: collapsed.has(id), collapsible: settings.dashboard.collapsible, icon: SECTION_ICONS[id], identity: ctx.identity });

  // Before anything has ever reported, eight empty cards is a worse answer than one clear one.
  // This is the first thing a Marketplace installer sees, and the sections have nothing to say
  // yet by definition — so say what to do instead of showing eight ways of saying "nothing".
  // Every source of content, not just history: track_delta / impact / access all write the
  // moment they are called, so a run killed before complete() leaves real data with no history
  // row — and hiding it behind "nothing has reported yet" would be a plain falsehood.
  const nothingEverReported = !data.progress
    && data.tasks.length === 0
    && data.history.length === 0
    && Object.keys(data.deltas ?? {}).length === 0
    && Object.keys(data.impact ?? {}).length === 0
    && !(data.access?.nodes?.length);
  if (nothingEverReported && !data.readErrors.length) {
    const where = data.logsDirExists ? `Watching <code>${esc(data.logsDir)}</code>.` : `It will watch <code>${esc(data.logsDir)}</code>, which does not exist yet.`;
    return `<div class="empty-state">
  <div class="es-icon">${icon('pulse')}</div>
  <div class="es-title">No script has reported yet</div>
  <div class="es-text">Add five lines to a script and it appears here — live progress, run history, and what each run found.<br>${where}</div>
  <div class="es-actions">
    <button class="btn" data-msg="simulate">${icon('beaker')}<span>Simulate a demo run</span></button>
    <button class="btn btn-secondary" data-msg="walkthrough">${icon('book')}<span>Getting started</span></button>
    <button class="btn btn-secondary" data-msg="layout">${icon('layout')}<span>Choose a layout</span></button>
  </div>
</div>`;
  }

  if (data.readErrors.length) {
    parts.push(`<div class="read-errors">${icon('info')} ${data.readErrors.map(esc).join('<br>')}</div>`);
  }

  const drawn = new Set<SectionId>();
  for (const id of settings.sectionOrder) {
    if (!enabled(id) || drawn.has(id)) continue;
    drawn.add(id);
    // 🔴 A section that throws must not take the dashboard with it.
    //
    // Nothing on the path from here to the webview catches anything - not dashboardHost's
    // refresh, not extension.ts's - so one malformed entry in one array raised a TypeError
    // that stopped the post entirely, and the webview went on displaying its last-good HTML
    // for ever with no error anywhere. The user sees a dashboard that has simply stopped
    // moving and has nothing to report. The entries themselves are normalised at the read
    // boundary now; this is the net under that, because these files are an open contract and
    // the next unexpected shape is not one we have thought of yet.
    try {
      switch (id) {
        case 'summary': parts.push(renderSummary(data, settings, ctx.now, narrow)); break;
        case 'activeTask': parts.push(renderActiveTask(data, settings, ctx.now, o(id))); break;
        case 'warnings': parts.push(renderWarnings(data, o(id))); break;
        case 'lastCompleted': parts.push(renderLastCompleted(data, settings, ctx.now, o(id))); break;
        case 'quickActions': parts.push(renderQuickActions(data, settings, ctx.now, ctx.trusted, o(id))); break;
        case 'processCalendar': parts.push(renderProcessCalendar(data, settings, ctx.now, o(id), narrow)); break;
        case 'timeline': parts.push(renderTimeline(data, settings, ctx.now, o(id), narrow)); break;
        case 'deltaTracker': parts.push(renderDeltaTracker(data, settings, ctx.now, o(id))); break;
        case 'metrics': parts.push(renderMetricsExplorer(data, settings, ctx.now, o(id), narrow)); break;
        case 'runHistory': parts.push(renderRunHistory(data, settings, o(id))); break;
        case 'warningTrends': parts.push(renderWarningTrends(data, settings, ctx.now, o(id), narrow)); break;
        case 'scriptHealth': parts.push(renderScriptHealth(data, settings, ctx.now, o(id))); break;
        case 'accessMap': parts.push(renderAccessMap(data, settings, ctx.now, ctx.surface, o(id), ctx.graph)); break;
        case 'pendingActions': parts.push(renderPendingActions(data, settings, ctx.now, o(id))); break;
        case 'impact': parts.push(renderImpact(data, settings, ctx.now, o(id))); break;
      }
    } catch (e) {
      const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      parts.push(`<section class="section" data-section="${esc(id)}"><div class="section-title">`
        + `<span class="section-name">${esc(SECTION_TITLES[id] ?? id)}</span></div>`
        + `<div class="section-body"><div class="read-errors">${icon('warning')} This section could not be drawn `
        + `(${esc(why)}). Everything else on this page is unaffected.</div></div></section>`);
    }
  }

  const attempted = settings.sectionOrder.some(enabled);
  // Two different empty states, because they need two different fixes. When sections ARE enabled
  // but the sidebar's own allow-list hides all of them, "every section is switched off" is simply
  // untrue - the panel is showing thirteen of them at that moment - and the button it offered
  // opened the wrong setting.
  const narrowFilterHidesAll = narrow && !attempted
    && settings.sidebarSections.length > 0 && settings.sectionOrder.some(id => settings.sections[id]);
  if (narrowFilterHidesAll) {
    parts.push(`<div class="empty-state"><div class="es-icon">${icon('layout')}</div><div class="es-title">Nothing is on the sidebar list</div><div class="es-text">Sections are switched on, but <code>dashboard.sidebarSections</code> is limiting the sidebar to a set that is all hidden. Clear it to show everything here.</div><button class="btn" data-msg="settings">${icon('settings-gear')}<span>Open settings</span></button></div>`);
  } else if (!attempted) {
    parts.push(`<div class="empty-state"><div class="es-icon">${icon('layout')}</div><div class="es-title">Every section is switched off</div><div class="es-text">Pick the ones you want to see.</div><button class="btn" data-msg="sections">${icon('checklist')}<span>Choose sections</span></button></div>`);
  } else if (parts.filter(Boolean).length === 0) {
    parts.push(`<div class="empty-state"><div class="es-icon">${icon('inbox')}</div><div class="es-title">Nothing to show yet</div><div class="es-text">The enabled sections are empty.</div></div>`);
  }
  return parts.filter(Boolean).join('\n');
}
