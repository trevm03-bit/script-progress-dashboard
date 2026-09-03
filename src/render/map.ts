// The Access Map's DOM (toolbar, canvas, detail card). Pure markup; media/accessMap.js owns
// everything inside .map-host once it is on the page.

export function mapMarkup(large: boolean): string {
  return `
<div class="map-toolbar">
  <input type="search" class="map-search" placeholder="Search nodes…" aria-label="Search nodes" spellcheck="false">
  <select class="map-layout" title="Layout" aria-label="Layout"><option value="force">Force</option><option value="radial">Radial</option></select>
  <select class="map-window" title="Time window" aria-label="Time window"><option value="0">All time</option><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option></select>
  <select class="map-labels" title="Labels" aria-label="Labels"><option value="auto">Labels: auto</option><option value="all">Labels: all</option><option value="scripts">Labels: scripts</option></select>
  <button class="icon-btn map-fit" title="Fit to view"><i class="codicon codicon-screen-full"></i></button>
  <button class="icon-btn map-reset" title="Re-run the layout"><i class="codicon codicon-debug-restart"></i></button>
  ${large ? '' : '<button class="icon-btn" data-msg="openMap" title="Open as its own tab"><i class="codicon codicon-link-external"></i></button>'}
</div>
<div class="map-legend"></div>
<div class="map-host ${large ? 'map-host-large' : ''}">
  <canvas class="map-canvas" aria-label="Access map"></canvas>
  <div class="map-tip" hidden></div>
  <aside class="map-detail" hidden></aside>
  <div class="map-hint">drag to pan · wheel to zoom · drag a node · click for detail · double-click to reset</div>
</div>`;
}

/** The sidebar's small live preview. */
export function miniMapMarkup(): string {
  return `<div class="map-host map-host-mini" title="Open the Access Map"><canvas class="map-canvas" aria-label="Access map preview"></canvas></div>`;
}
