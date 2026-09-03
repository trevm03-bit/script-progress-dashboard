"use strict";
// The Access Map's DOM (toolbar, canvas, detail card, context menu, overlay). Pure markup;
// media/accessMap.js owns everything inside .map-host once it is on the page.
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapMarkup = mapMarkup;
exports.miniMapMarkup = miniMapMarkup;
function mapMarkup(large) {
    return `
<div class="map-toolbar">
  <input type="search" class="map-search" placeholder="Search nodes…  ( / )" aria-label="Search nodes" spellcheck="false">
  <select class="map-layout" title="Layout" aria-label="Layout"><option value="force">Force</option><option value="radial">Radial</option></select>
  <select class="map-window" title="Time window" aria-label="Time window"><option value="0">All time</option><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option></select>
  <select class="map-labels" title="Labels" aria-label="Labels"><option value="auto">Labels: auto</option><option value="all">Labels: all</option><option value="scripts">Labels: scripts</option></select>
  <span class="map-tools">
    <button class="icon-btn map-replay" title="Replay the last runs through the map"><i class="codicon codicon-play-circle"></i></button>
    <button class="icon-btn map-fit" title="Fit to view (F)"><i class="codicon codicon-screen-full"></i></button>
    <button class="icon-btn map-reset" title="Re-run the layout (R)"><i class="codicon codicon-debug-restart"></i></button>
    <button class="icon-btn map-png" title="Save as PNG"><i class="codicon codicon-device-camera"></i></button>
    ${large ? '<button class="icon-btn map-full" title="Fullscreen"><i class="codicon codicon-screen-normal"></i></button>' : '<button class="icon-btn" data-msg="openMap" title="Open as its own tab"><i class="codicon codicon-link-external"></i></button>'}
  </span>
</div>
<div class="map-legend"></div>
<div class="map-host ${large ? 'map-host-large' : ''}">
  <canvas class="map-canvas" aria-label="Access map"></canvas>
  <div class="map-tip" hidden></div>
  <aside class="map-detail" hidden></aside>
  <div class="map-menu" hidden></div>
  <div class="map-overlay" hidden></div>
  <div class="map-hint">drag to pan · wheel to zoom · drag a node · click for lineage · right-click for menu · double-click to reset</div>
</div>`;
}
/** The sidebar's small live preview. */
function miniMapMarkup() {
    return `<div class="map-host map-host-mini" title="Open the Access Map"><canvas class="map-canvas" aria-label="Access map preview"></canvas></div>`;
}
//# sourceMappingURL=map.js.map