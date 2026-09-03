# Script Progress Dashboard

A VS Code extension that shows what your long-running scripts are doing, right now, without
leaving the editor. Your scripts write a few small JSON files; the extension watches them.

- **No network, no AI, no dependencies.** The extension reads local files. Nothing leaves the machine.
- **Theme-native.** Every colour is a VS Code theme variable, so it looks right in Light, Dark and High Contrast.
- **Every section is a switch.** Turn on what you use.
- **Any language.** A Python reporter is included; the file format is simple enough to write from Node, Bash or anything else.

## What you get

| Section | Shows | Setting | Default |
|---|---|---|---|
| Status bar | One line: `⟳ 3/7 Mapping · 2m10s`, stalled / complete / failed states. Click opens the dashboard | `statusBar.enabled` | on |
| Active Task | Progress bar, step label, detail line, live elapsed time, ETA from prior runs, warning count | `sections.activeTask` | on |
| Warnings | Warnings the running script raised, newest first (hidden when there are none) | `sections.warnings` | on |
| Last Completed | Status, duration and warning count of the most recent run, plus its summary | `sections.lastCompleted` | on |
| Run History | Sortable table of the last N runs | `sections.runHistory` | on |
| Process Calendar | Expected daily / weekly / monthly processes: done, pending or overdue | `sections.processCalendar` | off |
| Quick Actions | Buttons that run commands in a terminal, with optional confirmation and `${prompt:…}` inputs | `sections.quickActions` | off |
| Delta Tracker | Sparkline per numeric metric with current / min / max / trend | `sections.deltaTracker` | off |
| Script Health | Most recent run per script, with stale detection | `sections.scriptHealth` | off |
| Access Map | A 2D constellation of scripts and the files, tables and services they touch; the running script's links pulse | `sections.accessMap` | off |

The dashboard lives in two places: the **Script Progress** icon in the Activity Bar (a sidebar
view that stays open while you work) and **Script Progress: Open Dashboard** (a full editor tab,
which is where the Access Map is drawn).

## Install

### From the `.vsix`

```
code --install-extension script-progress-dashboard-1.0.0.vsix
```

or in VS Code: Extensions view → `…` menu → **Install from VSIX…**

### Without any tooling (unpacked folder)

Copy this folder (you need `package.json`, `out/`, `media/`, `LICENSE`, `README.md`; `node_modules`
is not needed) to:

```
%USERPROFILE%\.vscode\extensions\trevor-marshall.script-progress-dashboard-1.0.0\
```

then run **Developer: Reload Window**. The compiled `out/` folder is committed for exactly this reason.

## Report progress from a script

Copy `python/progress.py` into your project, for example `scripts/lib/progress.py`. It needs
nothing outside the Python standard library (3.10+).

```python
from lib.progress import Progress

with Progress("Nightly Load") as p:              # 'with' reports a crash as FAILED automatically
    p.step(1, 3, "Reading input file")
    p.access("file", "input/orders.csv")         # optional: feeds the Access Map
    p.detail("Rows: 3,990")

    p.step(2, 3, "Loading warehouse table")
    p.access("table", "sales.orders", mode="write")
    p.warn("12 rows had no customer id")

    p.step(3, 3, "Reconciling")
    p.track_delta("reconciliation_delta", 0.0)   # optional: feeds the Delta Tracker
    p.complete(success=True, summary="INSERT: 3,990 rows")
```

Every call also prints to the terminal, so the console tells the same story as the dashboard.

**Where the files go.** The reporter writes into a `logs` folder found in this order: the
`logs_dir` argument → the `PROGRESS_LOGS_DIR` environment variable → the nearest parent folder of
`progress.py` that contains a `logs/` or `.git/` folder (so `scripts/lib/progress.py` writes to
`<project>/logs/`) → `./logs`. Point the extension at the same folder with `scriptProgress.logsPath`
(relative to the first workspace folder, or absolute).

### The files

| File | Written by | Content |
|---|---|---|
| `progress.json` | every call | the current task: status, step, label, detail, elapsed, eta, warnings, `updatedAt` |
| `run_history.json` | `complete()` | last 100 runs: task, date, success, elapsed, summary, warning count |
| `deltas.json` | `track_delta()` | `{ "metric": [ { "date", "value", "task" }, … ] }`, last 50 points each |
| `access.json` | `access()` | `{ "nodes": [ { id, type, label, lastSeen } ], "edges": [ { from, to, mode, count, lastSeen } ] }` |

Writes are atomic (temp file + rename), so the extension never reads a half-written file. If it
ever does see bad JSON it keeps the last good copy and says so at the top of the dashboard.

## Configure

Example `settings.json` (workspace or user):

```json
{
  "scriptProgress.logsPath": "logs",
  "scriptProgress.staleRunningMinutes": 30,

  "scriptProgress.sections.processCalendar": true,
  "scriptProgress.processCalendar.processes": [
    { "name": "Nightly Load",    "label": "Nightly Load",    "frequency": "daily" },
    { "name": "Weekly Rollup",   "label": "Weekly Rollup",   "frequency": "weekly" },
    { "name": "Month-End Close", "label": "Month-End Close", "frequency": "monthly", "dayOfMonth": 5 }
  ],

  "scriptProgress.sections.quickActions": true,
  "scriptProgress.quickActions.buttons": [
    { "label": "Nightly Load", "command": "python scripts/nightly_load.py", "icon": "play", "group": "Daily" },
    { "label": "Month-End Close", "command": "python scripts/month_end.py --month ${prompt:Month (YYMM)}", "icon": "calendar", "confirm": true, "group": "Monthly" }
  ],

  "scriptProgress.sections.deltaTracker": true,
  "scriptProgress.deltaTracker.metrics": ["reconciliation_delta"],

  "scriptProgress.sections.scriptHealth": true,
  "scriptProgress.scriptHealth.staleHours": 168,

  "scriptProgress.sections.accessMap": true
}
```

Notes:

- **Process Calendar** matches a process to runs whose task name *starts with* `name`
  (case-insensitive), so `"Nightly Load"` covers `Nightly Load Phase 2`. Daily is overdue after
  12:00 local if it has not run today; weekly is overdue once a whole ISO week was missed; monthly
  is overdue after `dayOfMonth`.
- **Quick Actions** run in a terminal named *Script Progress*, whose working directory is the
  workspace folder, so write paths relative to it. `${prompt:Question}` anywhere in a command asks
  for a value first. `confirm` defaults to `true`. In an **untrusted workspace** the buttons are
  disabled and workspace-defined buttons are ignored (the extension declares limited support for
  workspace trust).
- **Stalled** means `progress.json` still says *running* but has not been updated for
  `staleRunningMinutes`. Using `with Progress(...)` in Python avoids this by reporting crashes.
- **Access Map** node types: `task` (your scripts), `file`, `table`, `api`, `other`. Solid lines
  are writes, dashed lines are reads; width grows with use. Click a node to focus its neighbourhood,
  click a legend entry to hide a type, double-click the canvas to reset. Honours reduced-motion.

## Try it

Open the `demo/` folder as a workspace (it carries settings that switch every section on), open the
Script Progress sidebar, then click **Run demo** under Quick Actions, or in a terminal opened in that
folder:

```
python fake_run.py --fast
```

Also try `--fail`, `--crash` (reported by the `with` block) and `--stall` (exits without reporting;
the dashboard flips to *Stalled* after the demo's one-minute threshold).

## Build from source

```
npm install          # TypeScript + types + codicons, dev-time only
npm run compile      # tsc -> out/  (also refreshes media/codicons/)
npm test             # node --test, no VS Code download needed
python python/test_progress.py
npm run package      # dist/script-progress-dashboard-1.0.0.vsix (uses npx @vscode/vsce)
```

Press **F5** in this folder to launch an Extension Development Host on the demo workspace.

## Commands

| Command | Does |
|---|---|
| Script Progress: Open Dashboard | Opens the full dashboard in an editor tab |
| Script Progress: Show Run History | Dumps run history to an output channel |
| Script Progress: Refresh | Re-reads the files now |
| Script Progress: Open Logs Folder | Reveals the logs folder (offers to create it) |

## Known limits

- Relative `logsPath` resolves against the **first** workspace folder in a multi-root workspace.
- Two scripts finishing in the very same instant can race on `run_history.json`; the reporter
  retries, but one row could be lost (never corrupted).
- `progress.json` is a single slot: two scripts running at once take turns owning the Active Task.
  History, deltas and the Access Map record both.

## Credits

Icons from [Codicons](https://github.com/microsoft/vscode-codicons) (Microsoft; code MIT, icons
CC-BY-4.0). Extension © 2026 Trevor Marshall, MIT licence.
