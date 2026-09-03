// Access Map section shell. The sidebar gets a summary + "Open map" button; the panel gets
// the canvas, which media/accessMap.js draws from the graph posted alongside the HTML.
import { DashboardData, Settings, Surface } from '../types';
import { buildGraph, graphSummary } from '../logic/graph';
import { relativeTime } from '../logic/time';
import { esc, icon, section, empty } from './html';

export function renderAccessMap(data: DashboardData, settings: Settings, now: Date, surface: Surface): string {
  const g = buildGraph(data.access, data.progress, settings.accessMapMaxNodes);
  if (g.nodes.length === 0) {
    return section('accessMap', 'Access Map', empty('No access.json yet. Scripts add nodes with Progress.access(kind, name, mode).'));
  }
  const s = graphSummary(g);
  const summary = `<div class="map-summary">
  <span title="Scripts">${icon('terminal')} ${s.tasks}</span>
  <span title="Resources">${icon('database')} ${s.resources}</span>
  <span title="Connections">${icon('link')} ${s.edges}</span>
  <span class="muted" title="Last activity">${esc(relativeTime(s.lastSeen, now))}</span>
  ${g.dropped ? `<span class="muted" title="Hidden by maxNodes">+${g.dropped} hidden</span>` : ''}
</div>`;

  if (surface === 'sidebar') {
    return section('accessMap', 'Access Map', `${summary}<button class="btn" data-open-panel="1">${icon('graph')}<span>Open map</span></button>`);
  }

  // Panel: the canvas container. accessMap.js owns everything inside #access-map.
  const body = `${summary}
<div class="map-legend" id="map-legend"></div>
<div class="map-host" id="access-map"><canvas id="access-canvas" aria-label="Access map"></canvas><div class="map-tip" id="map-tip" hidden></div></div>
<div class="muted small">Click a node to focus it · click the legend to hide a type · double-click the canvas to reset</div>`;
  return section('accessMap', 'Access Map', body, 'card-map');
}
