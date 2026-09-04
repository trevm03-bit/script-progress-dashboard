# Roadmap

Triaged from a field review of v1.3.0 by a second engineer running the extension against real
recurring data jobs (5 processes, on Windows, in a sync-backed workspace). Their verdict was
"production-ready", with the friction concentrated in **setup** rather than in the tool.

Ordered by impact per unit of risk, not by the order they were reported.

## 1.3.1 — remove the setup friction (no new surface) — **shipped 2026-09-04**

Every item here is something that already went wrong for a real user, and none of it changes how the
extension behaves once it is working.

- [x] **Warn when settings are in a scope that will not apply.** A workspace opened from a
      `.code-workspace` file makes `.vscode/settings.json` folder-scope; keys set there lose to
      workspace scope and the section simply never appears — no error, no hint. On activation,
      compare `inspect()`'s `workspaceFolderValue` against `workspaceValue` for the settings that
      drive visible sections, and if buttons or processes are defined only at folder scope, say so
      once with a "move them" action. *(Reported as IS-1; the single biggest time sink in the field
      install.)*
- [x] **Catch failed settings writes.** `scriptProgress.toggleSections` lets a rejected
      `config.update()` surface as VS Code's bare "unable to write" message. Catch it, name the
      likely cause (invalid JSON in the target file, no folder open, file read-only or unsaved), and
      offer to write to User settings instead.
- [x] **Validate the settings that matter, loudly.** A button missing `command`, a process with a
      `dayOfMonth` out of range, a `logsPath` that resolves nowhere — all currently fail silently.
      Report them in the section itself rather than rendering an empty list.
- [x] ~~**Metric columns in the CSV export.**~~ **Already shipped in 1.3.0** — verified against the
      release commit: the export collects every metric key in range and adds a column per name.
      No change needed. *(IS-4, reported in error.)*
- [x] **Distinguish read from write in the dependency map.** *(Solid-vs-dashed and the arrowhead already shipped in 1.3.0; 1.3.1 adds the colour.)* Write edges carry the risk and currently
      look identical to reads. Colour and weight them differently, and say which is which in the
      legend. *(IS-5.)*
- [x] **Say "idle" when idle.** The status bar drops to an icon with no text between runs; the
      tooltip should still say when the last run was. *(IS-3.)*
- [x] **First warning inline in Run History.** For diagnostic scripts the warning text *is* the
      finding; making it cost an expand hides the payload. Show the first one truncated. *(FR-6.)*
- [x] Install docs: verifying via `~/.vscode/extensions/<id>-*` when `code --list-extensions` is
      unavailable, and falling back to the Extensions UI when the CLI cannot reach the Marketplace
      through a corporate proxy. Both hit in the field.

## 1.4.0 — coverage for work that is not a Python script — **shipped 2026-09-04**

- [x] **CLI mode for the reporter.** `python progress.py start "<task>"`, `step`, `warn`, `metric`,
      `complete` — so shell scripts, task runners, agent workflows and anything else can report
      without importing the module. Run identity persists in the existing progress file between
      calls. *(FR-1, ranked first by the reviewer.)* Shipped with `--print-id` / `--run` so two
      runs sharing a task name cannot silently write into each other — raised during the build.
- [x] **Multi-phase processes.** A process whose phases run on different days currently shows as done
      the moment the first phase lands, which is worse than showing nothing: it reports a state that
      is not true. Allow a process to declare required sub-tasks and render "2/3 complete" until all
      have run in the period. *(FR-4 — treated as a correctness bug, not a feature.)*
- [x] **Suppress overdue for processes that cannot yet report.** A process with no reporting source
      shows as permanently overdue, which trains the user to ignore the overdue colour — the one
      signal the calendar exists to give. Needs an explicit "not wired yet" state. *(4f.)*
- [x] **Detail on access edges.** `access(kind, name, mode, detail="...")` surfaced as a tooltip, so
      a write edge can say what it wrote rather than only that it wrote. *(FR-2.)*
- [x] **Local event file for external integration.** Write `last_event.json` on fail / stall /
      complete so another tool can watch for it. See the note below on why this is a file and not a
      webhook. *(FR-3, redesigned.)*

## 1.6.0 — make it actionable

A third round, from watching 1.5.0 run against real work. Two bugs reported alongside these are
**already fixed** and listed under *Fixed after 1.5.0* below.

- [ ] **Target line on the Delta Tracker.** Thresholds already draw guides at `min` and `max`, but
      the band is not the goal: with a range of ±5,000 and a target of 0, nothing on the chart says
      where clean *is*. An explicit `target` per metric draws that line and lets the card answer
      "are we at goal?" rather than only "which way is it moving?".
- [ ] **Declared dependencies between processes.** `dependsOn: ["<task name>"]` on a calendar
      process, giving a **blocked** state: *"waiting on Phase 1-2, which has not run this period"*.
      Blocked is a better signal than overdue for a downstream process, because there is nothing
      the reader can do about it yet — calling it overdue points the finger at the wrong step.
      🔴 **Declared, never inferred** (see the note under 1.5.0), and its meaning is exactly "the
      named process has not run in this period" — it cannot model a human round-trip, such as
      waiting for someone to send a file back. Say that in the docs or it will be trusted for
      something it does not know.
- [ ] **Pending Actions.** `p.warn("...", actionable=True)` marks a warning as a thing to *do*
      rather than a thing to note, and a section collects them. **Derived, not stored**: the list
      is the actionable warnings from each task's most recent *successful* run, so it clears
      itself correctly by construction and the extension keeps no state that can drift.
      🔴 The originally proposed rule — clear an item when a later run does not repeat it — would
      let a run that **failed early**, before reaching the check, silently mark real findings as
      handled. Only a successful run may clear, and the section shows when each item was last seen.
- [ ] **Buttons that know when they are pointless.** `enableWhen: { task, metric, … }` so a "fix"
      button can go inactive when the last audit found nothing to fix, instead of costing a
      two-minute run to discover that. **Disabled with the reason, not hidden**: a button that
      vanishes leaves the reader wondering where it went, and the reason ("last run found 0
      issues") is itself the information they wanted. The disable-while-running mechanism already
      exists to build on.

### Fixed after 1.5.0

- [x] 🔴 **The summary strip contradicted the calendar.** A process that had never reported showed
      as *not wired yet* in the Process Calendar while the strip announced it as `next: … overdue`.
      Cause: 1.4.0 excluded `unseen` from the overdue *count* but left it eligible to be the "next
      due" candidate, and its nominal due date is usually already past. Two views of one fact must
      never disagree — a dashboard that contradicts itself is worse than one that says less.
      Regression-tested, plus a guard that a "next due" can never be a past date.
- [x] **Currency symbols sat on the wrong side of the number** (`-25,984.76$`). A one-character
      unit was always appended; a currency symbol belongs before the digits and after the minus
      sign. Fixed for `$ £ € ¥ ₹ ₽ ₩ R$ C$ A$`; `%` and word units are unchanged.

## Considered and deferred

- **Append-only (JSONL) run history.** Would eliminate the read-modify-write race on simultaneous
  completions outright, which is the right end state. Deferred because it is a storage format change
  affecting the reporter, the extension reader, the CSV/HTML exports and every existing history file,
  and the race it fixes is rare and already retried and documented. Worth doing deliberately in a
  release of its own, with a migration, rather than folded into a feature release. *(4a.)*
- **Heartbeat while a step is long.** Would let a killed run be detected in about two minutes instead
  of waiting out the stall threshold. Real improvement, but it means the reporter writes on a timer
  rather than only on events, so it needs care around sync-backed folders where every write can
  contend. `substep()` already covers the common case. *(4d.)*
- **Grouped metric series and mail export.** Both reasonable, neither blocking anything. *(FR-5, FR-7.)*

## 1.5.0 — from "did it run?" to "what did it find?" — **shipped 2026-09-04**

A second round of field proposals, triaged the same way. The theme is right: the tool answers
"did it run" well, and the next question a diagnostic script provokes is always "what did it find,
how does that compare, and what do I do now?"

- [x] **Compare two runs.** Pick two rows in Run History and see the difference: metrics with their
      deltas, warnings gained and lost, duration change, which parts were clean either side. For a
      script whose output *is* the finding, comparison is the natural next question after "did it
      run?", and every input already exists in the history file. *(No new reporter API.)*
- [x] **Failure categories.** `p.fail(category="auth", summary="token expired")`, so the dashboard
      can say *3 of the last 5 failures were auth* instead of showing five separate stack traces.
      Categories are free text — the reporter must not pretend to know a taxonomy of everyone's
      failures. Cheap, and it turns repeat failures into a pattern you can act on.
- [x] **Import historical series.** A command that reads a plain `[{date, value, task}]` array into
      `deltas.json`, so a series that existed before this tool did starts with its real depth
      instead of at zero. Merge and de-duplicate by date; never silently replace what is there.
- [x] **Reminders from the calendar.** An optional `reminderDays` on a process: notify when a due
      date is approaching, not only once it has been missed. The calendar already knows everything
      needed; today it can only report the past.
- [x] **Weekly digest.** "Copy Daily Summary" for a week: what ran, what did not, what is overdue,
      how the tracked metrics moved, total warnings. One click, pasteable into a status email.
- [x] **Totals in Metrics Explorer.** Sum and mean per metric over the shown range, so a per-run
      number that is worth accumulating (a cost, a row count, a duration) can be read as a period
      total. *(See the note below: recording such a metric already works today.)*

### Reported as missing, but already working — verified against the code

- **Several `track_delta()` calls in one run.** Every call already appends its own point, and both
  survive: a "detected" value and a post-fix "resolved" value are both in `deltas.json` today.
  What is genuinely missing is that the chart cannot tell they belong to the *same run*, so it
  cannot say "found X, resolved to Y" — it just draws two points. **The real change was small and
  different from the one proposed**: the run id now rides on each delta point and the chart pairs
  them. Shipped in 1.5.0.
- **Recording a cost (or any other per-run number).** `p.metric("cost_usd", 0.12)` already works
  and already reaches the metric cards, run history and the CSV export. The gap is only that
  nothing *adds them up* — hence "Totals in Metrics Explorer" above rather than a reporter change.

### Needs a different design before it can be built

- **Dependency chains from the Access Map.** The map does know that one script writes what another
  reads, and turning that into "phase 4 is blocked, phase 1 has not run" would make it operational
  rather than illustrative. The catch: *observed access is not a declared dependency*. A script
  that reads a table on purpose from last month's snapshot is not blocked by this month's writer,
  and a dashboard that says "blocked" when nothing is blocked is worse than one that says nothing.
  Proposed shape: processes may **declare** `dependsOn` (a fact, and enforceable), while the map
  **suggests** candidates it has observed ("these two look ordered — declare it?"). Never assert a
  blockage from inference alone. Note that `subtasks` (1.4.0) already covers the common case of one
  process whose phases must all run.
- **Notes on a run.** Worth having — the reason a row looks alarming is exactly the thing that gets
  lost, and the next person to see it has no way back to the explanation. But it must **not** be
  stored in `run_history.json`: that file belongs to the reporter, which rewrites it on every run
  and trims it to the last hundred, so a note would be silently destroyed. A separate notes file
  keyed by run id keeps the ownership rule intact (the extension writes only what it owns) and
  survives history trimming.

## Rejected

- 🔴 **A blocking approval gate inside the reporter.** *(`p.require_approval("about to update 5
  records")` pausing the script until a VS Code notification is answered.)* The intent is right and
  the risk it targets is real, but this specific mechanism inverts the reporter's central promise:
  **the reporter must never be the reason the real job stops.** Today every write is wrapped so a
  reporting failure degrades to a printed note and the job carries on. A blocking gate makes the
  script depend on an editor being open and attended — run it from a scheduler, a terminal on
  another machine, or with the window closed, and it hangs forever holding whatever it had open.
  Adding a timeout only moves the question to "and then what?", where both answers are bad:
  proceeding defeats the gate, aborting hands the reporter the power to kill the job.
  **Do it in the script, where the authority belongs**: require an explicit `--apply` flag, prompt
  on stdin when interactive, and have the reporter *record* that an approval happened
  (`p.metric("approved_by", ...)`) so the dashboard can show it. Safety belongs in the thing doing
  the writing, not in the thing watching it.

- 🔴 **HTTP webhook on notification events.** *(FR-3 as originally proposed.)* "Nothing leaves the
  machine — no network, no telemetry" is not a feature of this extension, it is the reason it is
  installable somewhere that forbids the alternatives. It is stated in the Marketplace description, a
  README badge and the privacy section, and an outbound POST would make all three false. The
  local-file alternative above delivers the same integration with zero egress and no new trust
  question. **If a network feature is ever added it must be a separate, opt-in, clearly-labelled
  thing — never a quiet addition to a tool that advertises this promise.**
