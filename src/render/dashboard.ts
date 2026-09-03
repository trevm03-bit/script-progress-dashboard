// Assembles every enabled section into the HTML that goes inside the webview's #sections div.
// Pure: no vscode import, so the whole page can be rendered in a test from fixture data.
import { DashboardData, Settings, Surface } from '../types';
import { renderActiveTask } from './activeTask';
import { renderWarnings } from './warnings';
import { renderLastCompleted } from './lastCompleted';
import { renderRunHistory } from './runHistory';
import { renderProcessCalendar } from './processCalendar';
import { renderQuickActions } from './quickActions';
import { renderDeltaTracker } from './deltaTracker';
import { renderScriptHealth } from './scriptHealth';
import { renderAccessMap } from './accessMapSummary';
import { esc, icon } from './html';

export interface RenderContext {
  now: Date;
  surface: Surface;
  trusted: boolean;
}

export function renderSections(data: DashboardData, settings: Settings, ctx: RenderContext): string {
  const s = settings.sections;
  const parts: string[] = [];

  if (data.readErrors.length) {
    parts.push(`<div class="read-errors">${icon('info')} ${data.readErrors.map(esc).join('<br>')}</div>`);
  }

  // Order follows the spec's getHtml(): task, warnings, last completed, quick actions,
  // calendar, deltas, history, health — then the map last because it is the tallest.
  if (s.activeTask) parts.push(renderActiveTask(data, settings, ctx.now));
  if (s.warnings) parts.push(renderWarnings(data));
  if (s.lastCompleted) parts.push(renderLastCompleted(data, ctx.now));
  if (s.quickActions) parts.push(renderQuickActions(settings, ctx.trusted));
  if (s.processCalendar) parts.push(renderProcessCalendar(data, settings, ctx.now));
  if (s.deltaTracker) parts.push(renderDeltaTracker(data, settings, ctx.now));
  if (s.runHistory) parts.push(renderRunHistory(data, settings));
  if (s.scriptHealth) parts.push(renderScriptHealth(data, settings, ctx.now));
  if (s.accessMap) parts.push(renderAccessMap(data, settings, ctx.now, ctx.surface));

  if (parts.length === 0) {
    parts.push(`<div class="empty">Every section is switched off. Enable some under Settings → Script Progress Dashboard.</div>`);
  }
  return parts.join('\n');
}
