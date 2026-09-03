# Changelog

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
