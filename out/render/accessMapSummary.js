"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderAccessMap = renderAccessMap;
const graph_1 = require("../logic/graph");
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderAccessMap(data, settings, now, surface) {
    const g = (0, graph_1.buildGraph)(data.access, data.progress, settings.accessMapMaxNodes);
    if (g.nodes.length === 0) {
        return (0, html_1.section)('accessMap', 'Access Map', (0, html_1.empty)('No access.json yet. Scripts add nodes with Progress.access(kind, name, mode).'));
    }
    const s = (0, graph_1.graphSummary)(g);
    const summary = `<div class="map-summary">
  <span title="Scripts">${(0, html_1.icon)('terminal')} ${s.tasks}</span>
  <span title="Resources">${(0, html_1.icon)('database')} ${s.resources}</span>
  <span title="Connections">${(0, html_1.icon)('link')} ${s.edges}</span>
  <span class="muted" title="Last activity">${(0, html_1.esc)((0, time_1.relativeTime)(s.lastSeen, now))}</span>
  ${g.dropped ? `<span class="muted" title="Hidden by maxNodes">+${g.dropped} hidden</span>` : ''}
</div>`;
    if (surface === 'sidebar') {
        return (0, html_1.section)('accessMap', 'Access Map', `${summary}<button class="btn" data-open-panel="1">${(0, html_1.icon)('graph')}<span>Open map</span></button>`);
    }
    // Panel: the canvas container. accessMap.js owns everything inside #access-map.
    const body = `${summary}
<div class="map-legend" id="map-legend"></div>
<div class="map-host" id="access-map"><canvas id="access-canvas" aria-label="Access map"></canvas><div class="map-tip" id="map-tip" hidden></div></div>
<div class="muted small">Click a node to focus it · click the legend to hide a type · double-click the canvas to reset</div>`;
    return (0, html_1.section)('accessMap', 'Access Map', body, 'card-map');
}
//# sourceMappingURL=accessMapSummary.js.map