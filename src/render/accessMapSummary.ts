// Access Map section shell. The panel gets the full toolbar + canvas + detail card; the sidebar
// gets a summary line, a live mini preview and an "Open map" button. media/accessMap.js draws
// from the graph posted alongside the HTML.
import { DashboardData, Settings, Surface } from '../types';
import { buildGraph, DrawGraph, graphSummary } from '../logic/graph';
import { relativeTime } from '../logic/time';
import { esc, icon, section, empty, SectionOpts } from './html';
import { mapMarkup, miniMapMarkup } from './map';

export function renderAccessMap(data: DashboardData, settings: Settings, now: Date, surface: Surface, opts: SectionOpts, prebuilt?: DrawGraph): string {
  const g = prebuilt ?? buildGraph(data.access, data.tasks, settings.accessMap.maxNodes, settings.accessMap.timeWindowDays, now);
  if (g.nodes.length === 0) {
    return section('accessMap', 'Access Map', empty('No access.json yet. Scripts add nodes with Progress.access(kind, name, mode).', { msg: 'simulate', label: 'Simulate a demo run', icon: 'beaker' }), opts);
  }
  const s = graphSummary(g);
  const summary = `<div class="map-summary">
  <span title="Scripts">${icon('terminal')} ${s.tasks}</span>
  <span title="Resources">${icon('database')} ${s.resources}</span>
  <span title="Connections">${icon('link')} ${s.edges}</span>
  <span class="muted" title="Last activity">${esc(relativeTime(s.lastSeen, now))}</span>
  ${g.dropped ? `<span class="muted" title="Hidden by the cap or time window">+${g.dropped} hidden</span>` : ''}
  ${g.activeTasks.length ? `<span class="status-run">${icon('pulse')} live</span>` : ''}
</div>`;

  if (surface === 'sidebar') {
    const mini = settings.accessMap.sidebarPreview ? miniMapMarkup() : '';
    return section('accessMap', 'Access Map', `${summary}${mini}<button class="btn" data-msg="openMap">${icon('graph')}<span>Open map</span></button>`, opts);
  }
  return section('accessMap', 'Access Map', `${summary}${mapMarkup(false)}`, { ...opts, cls: 'card-map' });
}
