# Changelog

## 1.6.1 — 2026-09-04

> **1.6.0 was tagged and never published.** Five adversarial reviews went at that build before it
> reached anyone; what they found is in *Hardened before release* below. The version number moved
> rather than the tag, so the record of what was built when stays honest.

The operations release. The tool always watched scripts; this is the version that answers the
question underneath — *did it run, what did it find, and is it holding together.*

**New views**

- **Pending Actions** (on by default) — findings your scripts mark `actionable=True`, from each
  script's most recent *successful* run. Derived, never stored, so an item clears itself when a
  later successful run stops reporting it. A failed run never clears one.
- **Impact Summary** — running totals from the new `Progress.impact()`: overall, this month, and
  how many runs are behind each figure.
- **Coverage** in the summary strip — schedule adherence, run success and metrics-in-range, with
  its inputs and weights printed on the page beside it. Deliberately not called a data-quality
  score: this extension can see whether jobs ran and what they reported about themselves, not
  your data.

**The calendar answers more**

- `dependsOn` gives a **blocked** state — *waiting on Upstream Extract* — instead of blaming a
  downstream process for something it cannot act on.
- Per-process **compliance over time**: a dot per period and a percentage. Periods before a
  process first ran are shown hollow and excluded, so a new process is never "0% for the year".
- `reminderDays` warns before a due date rather than only after it is missed.

**Finding things sooner**

- **Metric regressions** — the anomaly detector now watches the numbers, not just the clock. Rows
  falling from 4,000 to 200 is the signal duration alone never gives you.
- **Structured warnings** — `count`, `category`, `severity`, `actionable`, all optional and
  backward compatible. Warning Trends groups by category when it is there.
- **Failure categories** — `p.fail("token expired", category="auth")`, so repeat trouble reads as
  *2 of the last 6 failures were auth*.

**Getting things out**

- **Generate Runbook** — a Markdown runbook from what the extension has observed, opening with a
  DRAFT banner and marking every gap it knows it cannot see. The steps a person performs are
  invisible to it, and it says so rather than presenting a tidy list with a missing step.
- **Copy Digest for Email (formatted)** — the weekly digest as rich text, with a rendered-file
  fallback where the clipboard route is unavailable.
- **Who ran it and from which commit**, recorded per run. Both opt-out; excluded from shared
  exports unless you turn `report.includeIdentity` on.

**Fit and finish**

- A real first-run: one welcome panel with a way forward, instead of eight empty cards.
- **Choose a Layout…** — Essentials, Operations or Everything in one click. Process Calendar and
  Script Health are now on by default.
- Buttons can disable themselves with a reason when the last run says they are not needed.
- Five more snippets: query, load, reconciliation, file ETL and a shell script using the CLI.
- A target line on the Delta Tracker, totals in Metrics Explorer, and the first warning inline in
  Run History.

**Fixed**

- The summary strip announced a never-reported process as *next due — overdue* while the calendar
  called it *not wired yet*. Two views of one fact must not disagree.
- Currency symbols sat after the number (`-25.00$`).
- A single malformed point in `deltas.json` or `impact.json` threw inside a renderer and blanked
  the dashboard.
- A CLI-driven run lost every warning past the first ten, actionable ones included.
- Metric regressions were inverted for metrics whose usual value is negative.
- `powershell.exe` and `git` were launched by bare name, which Windows resolves against the
  working directory before PATH.
- `logsPath` plus `events.file` let an untrusted workspace choose where a file was written. Both
  are now restricted, and the writer refuses without trust.

**Hardened before release**

Five independent adversarial reviews went at this build — the Python reporter, the extension's
lifecycle and leaks, cross-platform and theme rendering, the upgrade and settings matrix, and a
fresh-eyes hunt with no brief but "break it". Everything they found is fixed below, and every one
of their reproductions is now a test, because a defect nobody has a test for is a defect that
comes back.

*Correctness*

- Run History was **O(n²)**, once per second, for ever: the "Slow" chip re-scanned the whole
  history per row. 5,000 runs took 1.4 s to draw; the same page now takes 54 ms.
- The one-second refresh keyed off the raw `status` field, so a script you pressed Ctrl-C on
  pinned the extension to a full re-render every second for the life of the window — while the
  UI itself correctly said *stalled*.
- A process exit was matched by **prefix**, so one button ending marked every running script whose
  name started the same way as crashed — false error toasts, and bogus events written to disk.
  Exits now resolve to the one script they belong to, or are reported without blaming anyone.
- `formatDuration` printed durations that cannot exist: `1m60s`, `59m60s`, `60s`.
- Due-date reminders fired on activation in every window, every day of the reminder window — the
  guard against exactly that could never run.
- `last_event.json` kept only the last of two transitions arriving together, and the one dropped
  was as likely as not the failure.
- The exported HTML report **ignored `report.includeIdentity` entirely**, so your username and
  commit went into every exported file whatever the setting said, in the artefact most likely to
  be sent to someone else.
- Export Report crashed on an `access.json` node type outside the known five — `"Table"` with a
  capital T was enough.
- A `frequency` colliding with a JavaScript built-in (`constructor`, `toString`) threw inside the
  calendar renderer and blanked the whole dashboard.
- Script Health and Pending Actions disagreed about which of two same-second runs was the latest.
- The CSV header row was not quoted, so a metric name containing a comma shifted every column.
- The weekly digest and the coverage figure had no upper bound on their window: a clock-skewed
  run dated next year counted toward "this week".
- A `dependsOn` naming nothing left a process permanently *blocked* — which counts as neither
  overdue nor missing, so one typo silently **raised** your coverage from 42% to 83%. Unmatched
  and self-referential dependencies are now reported.
- A repeated id in `sectionOrder` rendered the section twice, and only the first copy responded
  to the search box and filter chips.
- The sidebar said *every section is switched off* while the panel was showing thirteen of them.
- `coverage.weights.*` were read by the extension and declared nowhere, so there was no settings
  entry, no schema, and a squiggle if you typed them by hand.
- Two listeners leaked per sidebar hide/show cycle, each one firing another full re-render.

*Off Windows*

- **Copy Digest for Email** did nothing at all on macOS and Linux — it left the clipboard
  untouched and said so. It now uses `osascript` on macOS and `xclip` on Linux.
- `python` is not a binary on a stock Mac or most Linux distributions; the default interpreter
  now resolves to `python3` there, and `powershell` to `pwsh`.
- Shell quoting used cmd rules everywhere, so `report(v2).py` was a bash syntax error and
  `run$(id).py` was a command substitution. POSIX paths are single-quoted now, and cmd doubles a
  quote rather than backslashing it.

*Legibility*

- The metric delta chips measured **1.55:1** — the least readable thing on the page — because
  status colours tuned for the editor background were painted on a badge, with opacity on top.
- On a light theme the warning colour was 2.6:1 as body text, on the warning line specifically:
  the one thing on the row that has to be read.
- Under High Contrast the progress **track** rendered as a saturated bar that read as complete;
  in a theme defining neither border colour, "unknown" SLA dots were invisible.
- `prefers-reduced-motion` missed the spinner, so a running task span for ever for a reader who
  had asked the OS for no motion.
- The sidebar scrolled sideways at every realistic width.
- The Impact grid collapsed to a single card 1,719 px wide holding one number.
- The footnote under the summary tiles had no stylesheet rule at all, so it rendered louder than
  the labels it explains.
- Warnings, Pending Actions and Impact rendered every item with no cap: 500 warnings produced an
  85 KB card that pushed every section below it off the page.
- A long metric name was truncated with a tooltip that described something else.

*The reporter*

- A lone surrogate — routine in a filename on Linux, and in some Windows error messages — raised
  `UnicodeEncodeError` out of the reporter and **replaced the script's own exception**, so the
  operator saw a codec error instead of their real failure. So did a full disk.
- One malformed row in `run_history.json` raised inside the constructor, bricking every future run
  of that task until someone hand-edited the file.
- `PROGRESS_LOGS_DIR` pointing at a file gave the calling script a raw traceback.
- The slot filename stripped everything outside `[a-z0-9]`, so `Nightly Load`, `Nightly-Load` and
  `NIGHTLY_LOAD` shared one file — and *every* non-ASCII task name shared the single slot `task`.
  Names now carry a hash.
- The `warnings` count in a CLI-driven run reported the survivors, not the total: 25 warnings were
  recorded as 20.
- `complete --run <id>` on a displaced run exited 0 having recorded nothing — silent, for the one
  subcommand that persists the run.
- A long-running job's slot was deleted after seven days by file mtime, making the run
  unresumable and its completion unrecordable.
- `metric` round-tripped through `float()`, so any integer above 2⁵³ was silently corrupted.
- A single held read handle on `progress.json` — a dashboard, a `tail`, an antivirus scan — cost
  **0.45 s per reporting call** and then discarded the write. Live-progress writes now take a
  short retry ladder, because the next one supersedes them anyway.
- Nothing capped warning, summary or metric text: five long warnings produced a 7 MB
  `progress.json` **and** a 7 MB history row, kept 100 times over.
- `.tmp` files left by a killed process were never swept.
- `status` printed a raw traceback on a corrupt `progress.json`.

*And the gate that should have caught them*

`npm run smoke` installs the packaged `.vsix` into a throwaway VS Code profile, runs real scripts
against the reporter **inside the package**, and asserts on what the real renderers produce. It
existed before this release but had never once run to completion: it drove `Code.exe` directly,
which on Windows hands its arguments to a detached window and never returns, so the gate timed out
instead of checking anything. It now goes through the CLI entry point the way `code.cmd` does.
28 checks, green.

Reporter 1.6.1. 207 Node tests, 30 + 27 Python tests, 28 packaged-install checks.

## 1.5.0 — 2026-09-04

From "did it run?" to "what did it find?". A second round of field proposals, triaged; the ones
here are the ones that survived it.

- **Compare two runs.** Expand a Run History row and click *Compare with…*, or run **Compare Two
  Runs…**. Every metric with its change, warnings split into new / gone / still there, the
  duration difference, whether the outcome flipped, and which resources one run touched and the
  other did not — as Markdown you can paste into a ticket. The previous run of the same task is
  offered first. Comparing backwards in time, or across two different scripts, is allowed and
  says so rather than being silently reordered.
- **Failures can name their kind.** `p.fail("token expired", category="auth")`. The summary strip
  then reports *2 of the last 6 failures were auth* instead of leaving six stack traces to be
  read one at a time, and each failed row carries its category. Categories are free text: nothing
  here pretends to know a taxonomy of everyone's failure modes. An unhandled exception is
  categorised by its type automatically.
- **A run that measures twice tells the whole story.** Call `track_delta()` more than once and the
  card reads *found 4.2K, resolved to 0*. Both values were always stored; they are now paired by
  run id, so unrelated readings are never joined up.
- **Weekly digest.** *Copy Weekly Digest* rolls up the week — what ran and how often, what failed
  and why, what is overdue or part-done, how each tracked metric moved — for the kind of status
  note that goes to someone who was not watching.
- **Calendar reminders.** `reminderDays` on a process notifies you before a due date instead of
  only once it has been missed. Once per due date, never a nag.
- **Totals in Metrics Explorer.** A sum per numeric metric across the runs in view, mean in the
  tooltip, so a per-run cost or row count reads as a period total.
- **Import an existing series.** *Import Delta History…* merges a plain `[{date, value, task}]`
  array into `deltas.json`, so a metric that predates this extension starts with real depth. It
  merges rather than replaces, skips duplicates, and says what it could not read.

Reporter 1.2.1. Two proposals from the same round were already working and are documented in
ROADMAP.md rather than rebuilt; one — a blocking approval gate inside the reporter — was rejected
there, because the reporter must never be able to stop the job it is only watching.

## 1.4.0 — 2026-09-04

Coverage for work that is not a Python script, and a calendar that stops asserting things that
are not true. From the same field review as 1.3.1.

- **The reporter has a command line.** `python progress.py start|step|warn|metric|access|
  complete …` — so a shell script, a scheduled task, a Makefile or an agent can report progress
  without importing anything. One run spans many processes: `start` creates it, later commands
  resume it from its file, `complete` closes it, and the run id, start time, warnings and metrics
  carry across all of them. Exit codes are `0` / `1` (usage) / `2` (nothing to attach to), and
  `complete` on a finished run is a no-op so a shell trap can call it unconditionally.
  - Two runs can share a task name — two agents both running the same thing. `start --print-id`
    hands back the run id and `--run <id>` on later calls makes a displaced run **fail loudly**
    instead of silently writing its steps into the run that took the slot.
- **Multi-phase processes.** A process can declare `subtasks`, and then reads `2 of 3 phases`
  with a pip per phase until every phase has run successfully in the period. Previously a process
  whose phases run on different days went green the moment the first one landed, which is worse
  than showing nothing: it reported a state that was not true.
- **A process that has never reported is "not wired yet", not overdue.** Permanent red for
  something that was never connected trains you to ignore red, which costs the calendar the one
  signal it exists to give. It is excluded from the overdue count and shown in its own muted state.
- **`access()` takes a `detail`**: `p.access("table", "sales.orders", "write", detail="5 records
  updated")`. The Access Map shows it under the resource name, so a write can say what it changed
  rather than only that it happened.
- **Optional local event file.** Turn on `scriptProgress.events.file` and the extension writes
  `last_event.json` on complete / failed / stalled / exited, for a watcher outside VS Code. Off by
  default, atomically written, and the only file the extension ever writes. There is deliberately
  no webhook: an outbound request would break the no-network promise that makes this installable
  where the alternatives are not.

Reporter version 1.2.0. **Copy `python/progress.py` out of the installed extension again** — the
command line only exists in this version.

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
