# Changelog

## 1.3.1 — 2026-09-04

Setup friction, all of it from a first independent install on someone else's machine. Nothing
here changes how the extension behaves once it is working.

- **Settings in a scope that cannot apply are now reported.** A window opened from a
  `.code-workspace` file does not read a folder's `.vscode/settings.json`, so buttons and
  processes defined there silently never appear — and an empty section reads as "not set up yet"
  rather than "set up somewhere I can't see". The extension now checks on activation and says
  which keys are affected, with a button to open the right file. Dismissible for good.
- **Malformed settings are described instead of dropped.** A button with no `command`, a monthly
  process with no `dayOfMonth` (which could never be overdue), an out-of-range `dayOfWeek`, a
  delta threshold on a metric that is not tracked, an inverted min/max — each used to be filtered
  out in silence. Each is now named, with its position and label, in the section it belongs to.
- **A failed settings write explains itself.** "Choose Dashboard Sections…" used to surface VS
  Code's bare "unable to write" message. It now names the likely causes — a JSON error in the
  target file, no folder open, read-only or unsaved — and offers to save to User settings instead.
- **Write edges in the Access Map are orange**, wider and solid against dashed reads: a script
  that only reads something cannot damage it, and that difference should be visible without
  hovering. In lineage view they stay neutral, so orange keeps meaning "upstream" there.
- **Run History shows the first warning inline.** For a diagnostic script the warning text is the
  finding; a count alone made you expand a row to learn what it found.
- **The status bar says something useful when idle** — how long ago the last run was, or, when
  nothing has ever reported, which folder it is watching.
- Install docs: the proxy/CLI mismatch, verifying an install without `code --list-extensions`,
  and the settings-scope trap above.

Reported but already working in 1.3.0, verified rather than changed: the run-history CSV export
already includes a column per metric, and the map already drew writes solid with an arrowhead.

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
