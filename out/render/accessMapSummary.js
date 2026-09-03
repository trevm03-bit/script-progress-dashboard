"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderAccessMap = renderAccessMap;
const graph_1 = require("../logic/graph");
const time_1 = require("../logic/time");
const html_1 = require("./html");
const map_1 = require("./map");
function renderAccessMap(data, settings, now, surface, opts) {
    const g = (0, graph_1.buildGraph)(data.access, data.tasks, settings.accessMap.maxNodes, settings.accessMap.timeWindowDays, now);
    if (g.nodes.length === 0) {
        return (0, html_1.section)('accessMap', 'Access Map', (0, html_1.empty)('No access.json yet. Scripts add nodes with Progress.access(kind, name, mode).', { msg: 'simulate', label: 'Simulate a demo run', icon: 'beaker' }), opts);
    }
    const s = (0, graph_1.graphSummary)(g);
    const summary = `<div class="map-summary">
  <span title="Scripts">${(0, html_1.icon)('terminal')} ${s.tasks}</span>
  <span title="Resources">${(0, html_1.icon)('database')} ${s.resources}</span>
  <span title="Connections">${(0, html_1.icon)('link')} ${s.edges}</span>
  <span class="muted" title="Last activity">${(0, html_1.esc)((0, time_1.relativeTime)(s.lastSeen, now))}</span>
  ${g.dropped ? `<span class="muted" title="Hidden by the cap or time window">+${g.dropped} hidden</span>` : ''}
  ${g.activeTasks.length ? `<span class="status-run">${(0, html_1.icon)('pulse')} live</span>` : ''}
</div>`;
    if (surface === 'sidebar') {
        const mini = settings.accessMap.sidebarPreview ? (0, map_1.miniMapMarkup)() : '';
        return (0, html_1.section)('accessMap', 'Access Map', `${summary}${mini}<button class="btn" data-msg="openMap">${(0, html_1.icon)('graph')}<span>Open map</span></button>`, opts);
    }
    return (0, html_1.section)('accessMap', 'Access Map', `${summary}${(0, map_1.mapMarkup)(false)}`, { ...opts, cls: 'card-map' });
}
//# sourceMappingURL=accessMapSummary.js.map