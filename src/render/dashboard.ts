// Assembles every enabled section into the HTML that goes inside the webview's #sections div,
// in the configured order, honouring the sidebar subset and collapsed state.
// Pure: no vscode import, so the whole page can be rendered in a test from fixture data.
import { DashboardData, SectionId, Settings, Surface } from '../types';
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
import { esc, icon, SectionOpts } from './html';

import { DrawGraph } from '../logic/graph';

export interface RenderContext {
  now: Date;
  surface: Surface;
  trusted: boolean;
  collapsed?: SectionId[];
  /** Pre-built access graph (the host builds it once per refresh); the section builds its own if absent. */
  graph?: DrawGraph;
}

export function renderSections(data: DashboardData, settings: Settings, ctx: RenderContext): string {
  const parts: string[] = [];
  const narrow = ctx.surface === 'sidebar';
  const enabled = (id: SectionId) => settings.sections[id] && (!narrow || settings.sidebarSections.length === 0 || settings.sidebarSections.includes(id));
  const collapsed = new Set(ctx.collapsed ?? []);
  const o = (id: SectionId): SectionOpts => ({ collapsed: collapsed.has(id), collapsible: settings.dashboard.collapsible });

  if (data.readErrors.length) {
    parts.push(`<div class="read-errors">${icon('info')} ${data.readErrors.map(esc).join('<br>')}</div>`);
  }

  for (const id of settings.sectionOrder) {
    if (!enabled(id)) continue;
    switch (id) {
      case 'summary': parts.push(renderSummary(data, settings, ctx.now)); break;
      case 'activeTask': parts.push(renderActiveTask(data, settings, ctx.now, o(id))); break;
      case 'warnings': parts.push(renderWarnings(data, o(id))); break;
      case 'lastCompleted': parts.push(renderLastCompleted(data, settings, ctx.now, o(id))); break;
      case 'quickActions': parts.push(renderQuickActions(data, settings, ctx.now, ctx.trusted, o(id))); break;
      case 'processCalendar': parts.push(renderProcessCalendar(data, settings, ctx.now, o(id), narrow)); break;
      case 'deltaTracker': parts.push(renderDeltaTracker(data, settings, ctx.now, o(id))); break;
      case 'runHistory': parts.push(renderRunHistory(data, settings, o(id))); break;
      case 'scriptHealth': parts.push(renderScriptHealth(data, settings, ctx.now, o(id))); break;
      case 'accessMap': parts.push(renderAccessMap(data, settings, ctx.now, ctx.surface, o(id), ctx.graph)); break;
    }
  }

  const attempted = settings.sectionOrder.some(enabled);
  if (!attempted) {
    parts.push(`<div class="empty">Every section is switched off. <button class="link-btn" data-msg="sections">${icon('checklist')}Choose sections</button></div>`);
  } else if (parts.filter(Boolean).length === 0) {
    parts.push(`<div class="empty">Nothing to show yet — the enabled sections are empty.</div>`);
  }
  return parts.filter(Boolean).join('\n');
}
