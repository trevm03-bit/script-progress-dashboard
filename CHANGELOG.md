# Changelog

## 1.3.0 — 2026-09-04

The listing release: what a stranger sees before installing.

- README rewritten for the Marketplace: an honest five-line tagline with the actual five lines,
  two animated GIFs (a run in the dashboard; the Access Map lighting up during a run), visible
  captions on every screenshot, "Is this for you?", a 30-second try-it path, and the offline
  install routes moved to `install/README.md`.
- New 256 px icon; sharper one-line description; repository, issues and Q&A links on the listing.
- Lineage card grammar ("1 downstream script loses its input").
- CI: releases are packaged by GitHub Actions on every version tag (publish waits for a secret).

## 1.2.1 — 2026-09-03

- README install commands and the unpacked-folder template name the current package. No code changes.

## 1.2.0 — 2026-09-03

Three new sections, anomaly detection, a shareable report, and a constellation worth staring at.

**New sections**
- **Run Timeline** — swim lanes per script over the last day or week: when runs happened, how
  long they took, what overlapped, clipped at the window edge with the true times on hover.
- **Metrics Explorer** — every metric a script reports, run by run, with a sparkline per numeric
  metric and the change against the previous run that reported it.
- **Warning Trends** — recurring warnings grouped by normalised message, a daily bar chart, which
  scripts raise them, rising or falling.

**Analysis**
- Duration anomalies: a run far slower than that script's median gets a **2.7×** flag in Run
  History (with a **Slow** filter chip), a note on Last Completed, and an optional notification.
- SLAs: `maxMinutes` on a Process Calendar entry flags runs over it, shows elapsed against the
  limit on the Active Task card, and `notifications.onSlow` warns the moment a running script
  passes it.
- Run History detail rows show each metric's delta and percentage against the previous run.
- Delta Tracker draws one card per script when several scripts report the same metric name,
  instead of one zigzag line across two scales.

**Access Map v3**
- Click a node for its **lineage**: upstream writers lit orange, downstream readers lit green,
  two hops out, with an impact line ("changing this touches 4 scripts").
- Right-click menu: focus, centre, hide the type, copy the name, show its runs.
- Motion means activity: traffic particles flow only along the links a running script is using
  (script→resource for writes, resource→script for reads), each resource flashes the moment the
  script first touches it, and a finished run replays its path. An idle map is completely still.
- Halos, type glyphs, age-based fading, birth rings for new nodes, a minimap, an optional static
  starfield — each its own setting.
- Toolbar: replay recent runs, fit, reset, **save as PNG**, open full-size; keyboard `/ F R Esc + -`.
- The camera follows the layout while it settles and refits after a resize, so the graph is
  never off-screen when the tab opens.
- Auto-fit accounts for label widths, so long names no longer clip at the right edge.

**Around the editor**
- **Export HTML Report** — a self-contained page of the whole dashboard with a static map, in
  light or dark to match the reader's system.
- Header status pill and last-refresh time on every surface; section icons; empty states.
- Timeline tick labels thin themselves with container queries, so nothing overlaps at sidebar width.

**Demo**
- `demo/seed_demo.py` writes two weeks of realistic history so every section has something to show.

## 1.1.0 — 2026-09-03

The "finished product" release. Everything below is a switch in Settings.

**Dashboard**
- Summary strip: runs / failures / warnings today, next due, stale scripts, metrics out of range.
- Collapsible sections that remember their state; `dashboard.sectionOrder`; `dashboard.sidebarSections`
  to keep only the core in the sidebar; `dashboard.density`.
- Active Task: one card per running script (concurrent runs), progress within a step, live log
  tail, metric chips, artifact links, and an **Exited** state when a Quick Action's process ends
  non-zero while the script still says "running".
- Last Completed: metric cards from `Progress.metric()`.
- Run History: search box and status chips, click-to-expand detail (metrics, warnings, resources,
  artifacts), CSV export, archive and clear commands.
- Process Calendar: month grid per process, "next due", `dayOfWeek` and `dueHour`.
- Script Health: last-five result dots, failure rate, average duration with trend.
- Delta Tracker: per-metric units, labels and decimals; thresholds with guide lines and highlights.
- Access Map v2: pan, zoom, drag, search, detail card, force or radial layout, time window, label
  modes, run replay, live particles, a sidebar mini preview and a full-size **Open Access Map** tab.

**Around the editor**
- Notifications on completion, failure, stall, new warnings and non-zero exits; optional native
  progress-notification mirror.
- Status bar click menu; Activity Bar badge (running count or failures today).
- Quick Actions as VS Code **tasks** (Terminal → Run Task), `${file}` and `cwd`, per-button `task`
  binding (last result shown, disabled while running), **Run with Script Progress** in the Explorer
  and editor context menus, `Run Quick Action…` picker (keybindable).
- Commands: Copy Daily Summary, Export Run History (CSV), Archive / Clear Run History, Choose
  Dashboard Sections, Simulate a Demo Run (no Python needed), Open Access Map, Open Getting Started.
- Getting Started walkthrough, JSON schemas for the data files, Python and JavaScript snippets,
  contributed theme colours (`scriptProgress.running/complete/failed/stalled`), default keybindings.

**Reporters**
- Python: `substep()`, `log()`, `metric()`, `artifact()`, `complete(metrics=…)`, `Progress.wrap`
  decorator, `quiet=`, per-task slot files (`progress/<slug>.json`), run ids, `python progress.py`
  status printer.
- New Node.js reporter (`reporters/progress.js`) with the same contract.

## 1.0.0 — 2026-09-02

First release: status bar, sidebar view and editor-tab dashboard, nine switchable sections, Python
reporter with atomic writes and crash reporting, demo workspace, unit tests.
