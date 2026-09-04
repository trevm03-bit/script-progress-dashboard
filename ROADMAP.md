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

## Rejected

- 🔴 **HTTP webhook on notification events.** *(FR-3 as originally proposed.)* "Nothing leaves the
  machine — no network, no telemetry" is not a feature of this extension, it is the reason it is
  installable somewhere that forbids the alternatives. It is stated in the Marketplace description, a
  README badge and the privacy section, and an outbound POST would make all three false. The
  local-file alternative above delivers the same integration with zero egress and no new trust
  question. **If a network feature is ever added it must be a separate, opt-in, clearly-labelled
  thing — never a quiet addition to a tool that advertises this promise.**
