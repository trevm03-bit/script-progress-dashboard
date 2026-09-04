# -*- coding: utf-8 -*-
"""
Script Progress Dashboard - Python reporter (v1.3).

Drop this file into your project (for example scripts/lib/progress.py) and call it from any
long-running script. It writes small JSON files that the VS Code extension watches. Nothing
here needs the internet or any package outside the standard library (Python 3.10+).

Usage:
    from lib.progress import Progress

    with Progress("Nightly Load") as p:            # 'with' = auto-reports a crash as FAILED
        p.step(1, 3, "Reading input file")
        p.access("file", "input/orders.csv")       # optional: feeds the Access Map
        p.detail("Rows: 3,990")
        p.log("first row looks sane")              # optional: live log tail in the dashboard
        p.step(2, 3, "Loading warehouse table")
        for i, chunk in enumerate(chunks):
            p.substep(i / len(chunks))             # optional: progress within a step
        p.access("table", "sales.orders", mode="write")
        p.warn("12 rows had no customer id")
        p.metric("rows_loaded", 3990)              # optional: metric cards + history + CSV
        p.artifact("output/load_report.xlsx")      # optional: clickable link in the dashboard
        p.step(3, 3, "Reconciling")
        p.track_delta("reconciliation_delta", 0.0) # optional: feeds the Delta Tracker
        p.complete(success=True, summary="INSERT: 3,990 rows")
        # ...or, on a failure you can name:  p.fail("token expired", category="auth")

Also:
    @Progress.wrap("Nightly Load")                 # decorator form: wraps a function in a run
    def main(p): ...

    python progress.py                             # prints the current status (no arguments)

Not a Python script? Every call above has a command-line equivalent, so a shell script, a
scheduled task or an agent can report too. One run spans many processes:

    python progress.py start    "Nightly Load" --total 3
    python progress.py step     "Nightly Load" 1 3 "Reading input"
    python progress.py warn     "Nightly Load" "12 rows had no customer id"
    python progress.py complete "Nightly Load" --summary "INSERT: 3,990 rows"

See the command line section at the bottom of this file for every command and the flags.

Files written (all in the logs folder, see below):
    progress.json            the most recently written task (status bar + Active Task)
    progress/<slug>.json     one file per task, so concurrent scripts each have a card
    run_history.json         one row per completed run (last 100), with metrics and warnings
    deltas.json              numeric series for the Delta Tracker (last 50 points per metric)
    access.json              scripts -> resources graph for the Access Map (last 150 nodes)

Where the logs folder is, in order of preference:
    1. the logs_dir argument,
    2. the PROGRESS_LOGS_DIR environment variable,
    3. the first parent folder of THIS file that contains a 'logs' folder or a '.git' folder,
       plus '/logs'  (so scripts/lib/progress.py -> <project>/logs),
    4. ./logs under the current working directory.
"""
import functools
import json
import math
import os
import hashlib
import re
import sys
import time
import traceback
import uuid
from datetime import datetime, timedelta
from pathlib import Path

__all__ = ["Progress", "resolve_logs_dir"]
__version__ = "1.6.1"

# Windows consoles default to cp1252; a stray non-ASCII character in a summary must never
# crash the script that is doing the real work.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:  # pragma: no cover - extremely defensive
        pass

HISTORY_KEEP = 100
# 🔴 Text caps. Nothing truncated a warning, a summary or a metric value, so five 1 MB warnings
# plus a 1 MB summary produced a 7 MB progress.json AND a 7 MB history row - and a history row is
# kept 100 times over and rewritten in full on every completion. A message nobody can read at
# 4,000 characters is not made more useful at a million.
MAX_TEXT = 4000
# Per-run list caps for the HISTORY row. access.json already caps its graph at 150 nodes; the row
# it came from kept all 1,500.
MAX_ACCESSED = 200
MAX_ARTIFACTS = 100
MAX_METRICS = 200
# Actionable warnings are deliberately never trimmed to the display limit - but "never trimmed"
# is not the same as "unbounded". At 3,000 the slot file is rewritten in full on every warn(),
# which is quadratic; this is a ceiling nobody legitimately reaches.
MAX_ACTIONABLE = 500
DELTA_KEEP = 50
ACCESS_NODE_KEEP = 150
IMPACT_KEEP = 500
WARNINGS_IN_PROGRESS = 10
WARNINGS_IN_HISTORY = 20
LOG_KEEP = 20
PRIOR_RUNS_FOR_ETA = 5
SLOT_PRUNE_DAYS = 2
SLOT_PRUNE_RUNNING_DAYS = 7


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _cli_number(text):
    """
    A CLI argument as the number it actually is.

    🔴 int FIRST. Everything went through float(), so `metric T id 9007199254740993` was recorded
    as ...992, a thirty-digit key came back mangled, and `-0.0` became `0` - silently, in the file
    the dashboard reads. Python ints are arbitrary precision; floats are not. Underscores are
    rejected too: `1_000` is Python literal syntax, not something a shell meant to type.
    """
    s = str(text).strip()
    if "_" in s:
        raise ValueError(f"{s!r} is not a number (underscores are Python syntax, not shell input)")
    try:
        return int(s)
    except ValueError:
        return float(s)


def _iso_seconds(value):
    """An ISO timestamp as a unix time, or None. Never raises."""
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except (TypeError, ValueError, OSError):
        return None


def _as_int(value, default=0):
    """int() that never raises - the reporter must survive a caller's typo and a corrupt slot."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _clip(value, limit=MAX_TEXT):
    """Cap a piece of free text, saying so, rather than carrying megabytes into every file."""
    s = str(value)
    return s if len(s) <= limit else s[:limit] + f"... [{len(s) - limit} more characters]"


def _slug(name: str) -> str:
    """
    Slot-file name for a task.

    🔴 The readable part is a hint; the HASH is what makes it unique. Stripping everything outside
    [a-z0-9] collapsed "Nightly Load", "Nightly-Load" and "NIGHTLY_LOAD" onto one slot - and every
    non-ASCII name in the system ("夜間ロード", "Отчёт", an emoji) onto the single slot "task", so
    two unrelated Japanese-named scripts silently overwrote each other's runs.
    """
    raw = name or ""
    s = re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")[:48]
    tag = hashlib.sha1(raw.encode("utf-8", errors="replace")).hexdigest()[:8]
    return f"{s}-{tag}" if s else f"task-{tag}"


def resolve_logs_dir(logs_dir=None, module_file=__file__) -> Path:
    """Pick the logs folder using the rules in the module docstring."""
    if logs_dir:
        return Path(logs_dir)
    env = os.environ.get("PROGRESS_LOGS_DIR")
    if env:
        return Path(env)
    here = Path(module_file).resolve().parent
    for parent in [here, *here.parents]:
        if (parent / "logs").is_dir() or (parent / ".git").exists():
            return parent / "logs"
    return Path.cwd() / "logs"



def _current_user() -> str:
    """
    Who is running this, best-effort. Used only to attribute a run when several people share the
    same scripts. Never raises: `os.getlogin()` fails outright in a service or a detached
    terminal, which is exactly where a reporter must not be the thing that breaks.
    Set PROGRESS_USER to override, or PROGRESS_NO_USER=1 to record nobody.
    """
    if os.environ.get("PROGRESS_NO_USER"):
        return ""
    override = os.environ.get("PROGRESS_USER")
    if override:
        return str(override)[:60]
    for key in ("USERNAME", "USER", "LOGNAME"):
        v = os.environ.get(key)
        if v:
            return str(v)[:60]
    try:
        return str(os.getlogin())[:60]
    except Exception:
        return ""


def _find_on_path(name: str) -> str:
    """
    Absolute path to an executable, searching PATH only.

    🔴 Never hand a bare name to subprocess on Windows: CreateProcess resolves it against the
    CURRENT DIRECTORY before PATH, so a script run from a shared drive or a downloads folder
    would execute an attacker's git.exe sitting next to it. `shutil.which` is no help here - on
    Windows it deliberately searches the current directory too. So walk PATH ourselves and return
    an absolute path, or nothing.
    """
    exts = [""] if os.name != "nt" else [e for e in os.environ.get("PATHEXT", ".EXE").split(os.pathsep) if e]
    for folder in os.environ.get("PATH", "").split(os.pathsep):
        folder = folder.strip('"')
        if not folder or not os.path.isabs(folder):
            continue          # a relative PATH entry resolves against the cwd; refuse it
        for ext in exts:
            candidate = os.path.join(folder, name + ext)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    return ""


def _git_commit(start: Path) -> str:
    """
    The commit the scripts are running from, so a change in behaviour can be lined up against a
    change in code. Best-effort and CHEAP: a short timeout, no shell, failure is silence. A
    reporter that hangs waiting for git is worse than one that never knew the commit.
    """
    if os.environ.get("PROGRESS_NO_GIT"):
        return ""
    exe = _find_on_path("git")
    if not exe:
        return ""
    try:
        import subprocess
        out = subprocess.run(
            [exe, "-C", str(start), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=3,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return out.stdout.strip()[:40] if out.returncode == 0 else ""
    except Exception:
        return ""


class Progress:
    def __init__(self, task_name: str, logs_dir=None, quiet: bool = False):
        self._paths(task_name, logs_dir, quiet)
        self.run_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        self.start_time = time.time()
        self.started_at = _now_iso()
        self.warnings = []
        # How many warn() calls this run has made, across every process that resumed it. The list
        # above is trimmed; this is not, so the recorded count stays true.
        self.warnings_total = 0
        self.log_lines = []
        self.metrics = {}
        self.artifacts = []
        self.accessed = []            # node ids touched this run, in order
        self.completed = False
        self.category = ""
        self.impacts = {}
        self.user = _current_user()
        self.commit = _git_commit(self.logs_dir.parent)
        self.current = {"step": 0, "total": 0, "label": "Starting", "detail": "", "substep": None}
        self._prior_durations = self._get_prior_durations()
        self._prune_slots()
        self._write()

    def _paths(self, task_name, logs_dir, quiet):
        """Everything a run needs to know about WHERE it writes. Shared by a new run and a resumed one."""
        self.task_name = task_name
        self.quiet = quiet
        self.logs_dir = resolve_logs_dir(logs_dir)
        # Never raise out of the constructor. PROGRESS_LOGS_DIR pointing at a FILE, or at a folder
        # the user cannot write, gave the calling script a raw FileExistsError/PermissionError
        # traceback from this one line - the reporter killing the job it exists to observe. Every
        # write below already degrades to a NOTE, so failing here just means no files.
        try:
            self.logs_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            print(f"  NOTE: cannot use {self.logs_dir} for progress files ({e.__class__.__name__}); "
                  f"reporting is off for this run", flush=True)
        self.slots_dir = self.logs_dir / "progress"
        self.progress_file = self.logs_dir / "progress.json"
        self.slot_file = self.slots_dir / (_slug(task_name) + ".json")
        self.history_file = self.logs_dir / "run_history.json"
        self.deltas_file = self.logs_dir / "deltas.json"
        self.access_file = self.logs_dir / "access.json"
        self.impact_file = self.logs_dir / "impact.json"

    @classmethod
    def resume(cls, task_name: str, logs_dir=None, quiet: bool = True, run_id: str = ""):
        """
        Reattach to a run that an earlier PROCESS started (this is what the command line uses).

        The run lives in its slot file, so a shell script can call this module once per step and
        every call adds to the same run: same run id, same start time, same accumulated warnings
        and metrics. Raises LookupError when there is nothing running to attach to, because
        silently starting a second run would corrupt the elapsed time and the history row.

        `run_id` makes that safe when two runs can share a task name - two agents both running
        "Morning Scan", say. The slot is keyed by NAME, so the second start takes it over; pass
        the id that `start` printed and a call belonging to the displaced run fails loudly
        instead of quietly writing its steps into the other run.
        """
        self = cls.__new__(cls)
        self._paths(task_name, logs_dir, quiet)
        data = self._read_json(self.slot_file, default=None)
        if not isinstance(data, dict) or data.get("status") != "running":
            raise LookupError(
                f'No run in progress for "{task_name}". Start one first: '
                f'python progress.py start "{task_name}"'
            )
        if run_id and data.get("runId") != run_id:
            raise LookupError(
                f'Run {run_id} of "{task_name}" is no longer the active one - the slot now holds '
                f'{data.get("runId")}. Another run of the same task name took it over; give each '
                f"concurrent run its own task name, or this run's steps would land in that one."
            )
        self.run_id = data.get("runId") or ""
        self.started_at = data.get("startedAt") or _now_iso()
        try:
            self.start_time = datetime.fromisoformat(self.started_at).timestamp()
        except (ValueError, OSError):
            # Unparseable timestamp: fall back to the elapsed already recorded, so the clock
            # keeps moving forward instead of resetting to zero.
            self.start_time = time.time() - float(data.get("elapsed") or 0)
        self.warnings = [w for w in (data.get("warnings") or []) if isinstance(w, dict)]
        try:
            self.warnings_total = max(int(data.get("warningsTotal") or 0), len(self.warnings))
        except (TypeError, ValueError):
            self.warnings_total = len(self.warnings)
        self.log_lines = [l for l in (data.get("log") or []) if isinstance(l, dict)]
        # A corrupt slot must be survivable. dict() on a list raised ValueError, and int() on a
        # string step raised too - so ONE bad slot file made every later subcommand crash rather
        # than fall back, with no way to recover short of deleting the file by hand.
        raw_metrics = data.get("metrics")
        self.metrics = dict(raw_metrics) if isinstance(raw_metrics, dict) else {}
        self.artifacts = list(data.get("artifacts") or [])
        self.accessed = list(data.get("accessed") or [])
        self.completed = False
        self.category = ""
        self.impacts = dict(data.get("impacts") or {})
        self.user = data.get("user") or ""
        self.commit = data.get("commit") or ""
        self.current = {
            "step": _as_int(data.get("step")),
            "total": _as_int(data.get("totalSteps")),
            "label": data.get("label") or "Running",
            "detail": data.get("detail") or "",
            "substep": data.get("substep"),
        }
        self._prior_durations = self._get_prior_durations()
        return self

    # ------------------------------------------------------------------ reporting API
    def step(self, step_num: int, total_steps: int, label: str):
        """Move to a new step. Prints it too, so the terminal shows the same story."""
        # Coerced, never raised: p.step("one", 3, "x") is a typo in the caller's script, and the
        # reporter's contract is that it does not take the job down for one.
        self.current = {"step": _as_int(step_num), "total": _as_int(total_steps), "label": _clip(label, 300), "detail": "", "substep": None}
        self._write()
        self._say(f"\n[{step_num}/{total_steps}] {label}...")

    def detail(self, text: str):
        """Update the detail line under the current step (row counts, file names...)."""
        self.current["detail"] = _clip(text, 300)
        self._write()
        self._say(f"  {text}")

    def substep(self, fraction: float):
        """Progress within the current step, 0.0 - 1.0 (e.g. i / len(chunks)). Cheap to call often."""
        try:
            f = max(0.0, min(1.0, float(fraction)))
        except (TypeError, ValueError):
            return
        prev = self.current.get("substep")
        self.current["substep"] = f
        # Only write when it moved by at least 1%, so tight loops do not hammer the disk.
        if prev is None or abs(f - prev) >= 0.01 or f >= 1.0:
            self._write()

    def log(self, message: str):
        """A short log line for the dashboard's log tail (last 20 kept). Also printed."""
        self.log_lines.append({"time": _now_iso(), "msg": str(message)})
        self.log_lines = self.log_lines[-LOG_KEEP:]
        self._write()
        self._say(f"  {message}")

    def warn(self, message: str, count=None, category: str = "", severity: str = "",
             actionable: bool = False):
        """
        Record a warning. Shows up in the dashboard and counts in run history.

        The extra fields are all optional and all backward compatible - `p.warn("text")` behaves
        exactly as before. They exist because free text can only be grouped by exact match, so
        "Section 6: 310 issues" and "Section 6: 311 issues" look like two unrelated problems:

            count      how many things this warning is about, so a steady 310 reads as steady
                       rather than as a new warning every run
            category   your own word for the KIND of finding, so it can be grouped and trended
            severity   'info' | 'warn' | 'error' - your judgement, nothing here infers it
            actionable True when this is something a HUMAN must go and do, as opposed to
                       something merely worth knowing. Actionable items are collected separately
                       so they do not drown in the noise of ordinary warnings.
        """
        self.warnings_total = int(getattr(self, "warnings_total", 0)) + 1
        item = {"time": _now_iso(), "msg": _clip(message)}
        if count is not None:
            try:
                item["count"] = int(count)
            except (TypeError, ValueError):
                self._say(f"  NOTE: count {count!r} ignored (not a whole number)")
        if category:
            item["category"] = str(category)[:60]
        if severity:
            if severity in ("info", "warn", "error"):
                item["severity"] = severity
            else:
                self._say(f"  NOTE: severity {severity!r} ignored (expected info, warn or error)")
        if actionable:
            item["actionable"] = True
        self.warnings.append(item)
        self._write()
        extra = ""
        if item.get("count") is not None:
            extra = f" ({item['count']})"
        self._say(f"  WARNING{extra}: {message}")

    def metric(self, name: str, value):
        """Record a named metric for this run (number or short string). Shown as a card, kept in history."""
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            value = _clip(value, 300)
        elif isinstance(value, float) and not math.isfinite(value):
            value = str(value)          # NaN / inf are not JSON; keep them as text, never poison the file
        self.metrics[str(name)] = value
        self._write()

    def artifact(self, path):
        """Record a file this run produced; the dashboard shows it as a clickable link."""
        p = str(path)
        if p not in self.artifacts:
            self.artifacts.append(p)
            self._write()
        self._say(f"  -> {p}")

    def track_delta(self, metric_name: str, value: float):
        """Append one numeric value to a named series for the Delta Tracker sparkline."""
        try:
            v = float(value)
        except (TypeError, ValueError):
            return
        if not math.isfinite(v):
            return
        deltas = self._read_json(self.deltas_file, default={})
        if not isinstance(deltas, dict):
            deltas = {}
        # The FILE being a dict is not enough - the series under this key has to be a list too.
        # impact() already guarded this; a hand-edited or third-party deltas.json holding
        # {"m": 5} made .append raise AttributeError straight into the calling script.
        series = deltas.get(metric_name)
        if not isinstance(series, list):
            series = []
        # runId lets the chart tell that two points came from the SAME run - a value found and
        # the value after a fix - instead of drawing two unrelated dots.
        series.append({"date": _now_iso(), "value": v, "task": self.task_name, "runId": self.run_id})
        deltas[metric_name] = series[-DELTA_KEEP:]
        self._safe_write(self.deltas_file, deltas)

    def impact(self, metric: str, value, label: str = ""):
        """
        Record a CONTRIBUTION this run made, to be accumulated across runs.

        The difference from `track_delta` is the question each answers. A delta is *current
        state*: "the discrepancy is now 0". An impact is *what this run contributed*: "this run
        identified 1,204 of discrepancy". Deltas are charted and replaced; impacts are summed.

            p.impact("corrections_found", 1204.50, label="Reconciliation corrections")

        🔴 Be precise about what the number counts, and write it down next to the script. A total
        is only as defensible as its definition, and "identified" is the word that gets
        questioned first - a discrepancy that passed through a check is not money recovered.
        """
        try:
            v = float(value)
        except (TypeError, ValueError):
            return
        if not math.isfinite(v):
            return
        entry = {"date": _now_iso(), "value": v, "task": self.task_name, "runId": self.run_id}
        if label:
            entry["label"] = str(label)[:80]
        data = self._read_json(self.impact_file, default={})
        if not isinstance(data, dict):
            data = {}
        series = data.setdefault(str(metric), [])
        if not isinstance(series, list):
            series = []
        series.append(entry)
        data[str(metric)] = series[-IMPACT_KEEP:]
        self._safe_write(self.impact_file, data)
        self.impacts[str(metric)] = self.impacts.get(str(metric), 0.0) + v
        # Persist the running total to the slot as well as the series file: a CLI run resumes
        # from the slot on every call, so a total held only in memory dies with the process.
        self._write()
        self._say(f"  + {metric}: {v:,.2f}{f' ({label})' if label else ''}")

    def access(self, kind: str, name: str, mode: str = "read", detail: str = ""):
        """
        Record that this task touched a resource, for the Access Map.
            kind:   'file' | 'table' | 'api' | 'other'
            name:   anything readable, e.g. 'input/orders.csv', 'sales.orders', 'CRM REST'
            mode:   'read' (default) or 'write'
            detail: optional, what was actually done - '5 records updated', 'full reload'.
                    Shown on the link in the Access Map, so a write can say what it wrote
                    rather than only that it wrote. The newest detail wins.
        Safe to call many times for the same resource: the edge count just goes up.
        """
        kind = kind if kind in ("file", "table", "api", "other") else "other"
        mode = "write" if str(mode).lower().startswith("w") else "read"
        task_id = f"task:{self.task_name}"
        res_id = f"{kind}:{name}"
        now = _now_iso()

        graph = self._read_json(self.access_file, default={"nodes": [], "edges": []})
        if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list):
            graph = {"nodes": [], "edges": []}
        nodes = {n["id"]: n for n in graph["nodes"] if isinstance(n, dict) and "id" in n}
        nodes[task_id] = {"id": task_id, "type": "task", "label": self.task_name, "lastSeen": now}
        nodes[res_id] = {"id": res_id, "type": kind, "label": str(name), "lastSeen": now}

        edges = [e for e in graph.get("edges", []) if isinstance(e, dict)]
        detail = str(detail)[:120] if detail else ""
        for e in edges:
            if e.get("from") == task_id and e.get("to") == res_id and e.get("mode") == mode:
                e["count"] = int(e.get("count", 0)) + 1
                e["lastSeen"] = now
                if detail:
                    e["detail"] = detail
                break
        else:
            edge = {"from": task_id, "to": res_id, "mode": mode, "count": 1, "lastSeen": now}
            if detail:
                edge["detail"] = detail
            edges.append(edge)

        # Cap: keep every task node, then the most recently seen resources.
        tasks = [n for n in nodes.values() if n.get("type") == "task"]
        resources = sorted([n for n in nodes.values() if n.get("type") != "task"], key=lambda n: n.get("lastSeen", ""), reverse=True)
        keep = tasks + resources[: max(0, ACCESS_NODE_KEEP - len(tasks))]
        keep_ids = {n["id"] for n in keep}
        edges = [e for e in edges if e.get("from") in keep_ids and e.get("to") in keep_ids]

        self._safe_write(self.access_file, {"nodes": keep, "edges": edges})
        if res_id not in self.accessed:
            self.accessed.append(res_id)
            self._write()

    def fail(self, summary: str = "", category: str = "", metrics: dict = None):
        """
        Finish the run as a failure, optionally saying what KIND of failure it was.

        `category` is free text you choose - "auth", "quota", "missing-input", "validation".
        Nothing here interprets it; the dashboard groups by it, so repeated trouble reads as
        "3 of the last 5 failures were auth" instead of five unrelated stack traces. Keep the
        words stable and short, or the grouping is worthless.
        """
        self.complete(success=False, summary=summary, metrics=metrics, category=category)

    def complete(self, success: bool = True, summary: str = "", metrics: dict = None, category: str = ""):
        """Mark the run finished and add it to run history. Called for you by 'with'."""
        if self.completed:
            return
        if metrics:
            for k, v in dict(metrics).items():
                self.metric(k, v)
        self.category = str(category)[:60] if category else ""
        self.completed = True
        elapsed = time.time() - self.start_time
        self.current["label"] = "Complete" if success else "FAILED"
        # Clipped: a summary is a sentence, and an unbounded one landed in progress.json AND in
        # a history row that is then kept 100 times over and rewritten on every completion.
        summary = _clip(summary)
        self.current["detail"] = summary
        self.current["substep"] = None
        self._write(status="complete" if success else "failed")
        self._append_history(bool(success), elapsed, summary)
        status = "COMPLETE" if success else "FAILED"
        self._say(f"\n=== {status} === ({self._fmt_duration(elapsed)})")
        if summary:
            self._say(f"  {summary}")

    # ------------------------------------------------------------------ context manager / decorator
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is not None and not self.completed:
            # The script crashed. Report it as a failure so the dashboard never shows a
            # phantom "running" task, then let the exception continue as normal.
            first_line = "".join(traceback.format_exception_only(exc_type, exc)).strip().splitlines()[-1]
            # The exception type is a serviceable category when the script did not choose one.
            self.complete(success=False, summary=f"Unhandled error: {first_line}", category=exc_type.__name__)
        elif not self.completed:
            self.complete(success=True, summary=self.current.get("detail", ""))
        return False  # never swallow the exception

    @classmethod
    def wrap(cls, task_name: str, logs_dir=None):
        """Decorator: run the function inside a Progress; it receives the reporter as its first argument."""
        def deco(fn):
            @functools.wraps(fn)
            def inner(*args, **kwargs):
                with cls(task_name, logs_dir=logs_dir) as p:
                    return fn(p, *args, **kwargs)
            return inner
        return deco

    # ------------------------------------------------------------------ internals
    def _say(self, text):
        if not self.quiet:
            print(text)

    def _write(self, status="running"):
        elapsed = time.time() - self.start_time
        data = {
            "task": self.task_name,
            "status": status,
            "step": self.current["step"],
            "totalSteps": self.current["total"],
            "label": self.current["label"],
            "detail": self.current["detail"],
            "substep": self.current.get("substep"),
            "elapsed": round(elapsed, 1),
            "eta": self._estimate_eta(elapsed) if status == "running" else None,
            "warnings": self._warnings_for_slot(),
            "warningsTotal": int(getattr(self, "warnings_total", 0)),
            "log": self.log_lines[-LOG_KEEP:],
            "metrics": dict(self.metrics),
            "artifacts": list(self.artifacts),
            "accessed": list(self.accessed),
            "runId": self.run_id,
            "startedAt": self.started_at,
            "updatedAt": _now_iso(),
            "impacts": dict(self.impacts),
        }
        if self.user:
            data["user"] = self.user
        if self.commit:
            data["commit"] = self.commit
        # Short ladder: a lost live-progress write is superseded by the next one, and paying
        # 0.45 s per call because the dashboard has the file open is a far worse trade.
        self._safe_write(self.progress_file, data, attempts=2, base=0.01)
        try:
            self.slots_dir.mkdir(parents=True, exist_ok=True)
            self._write_json(self.slot_file, data, attempts=2, base=0.01)
        except OSError:
            pass  # the slot file is a nicety; the main file is the contract

    def _estimate_eta(self, elapsed: float):
        """Seconds left, from the average of the last few successful runs of this task."""
        if not self._prior_durations:
            return None
        avg_total = sum(self._prior_durations) / len(self._prior_durations)
        return round(max(0.0, avg_total - elapsed), 1)

    def _get_prior_durations(self) -> list:
        history = self._read_json(self.history_file, default=[])
        if not isinstance(history, list):
            return []
        # 🔴 Coerce defensively. run_history.json is shared, hand-editable and synced by OneDrive
        # here, so a single row with "elapsed": null or "n/a" used to raise inside the CONSTRUCTOR
        # - which meant one malformed row permanently bricked every future run of that task.
        out = []
        for r in history:
            if not (isinstance(r, dict) and r.get("task") == self.task_name and r.get("success")):
                continue
            try:
                out.append(float(r["elapsed"]))
            except (KeyError, TypeError, ValueError):
                continue
        return out[-PRIOR_RUNS_FOR_ETA:]

    def _prune_slots(self):
        """Drop per-task files of runs that finished days ago (or were killed and left 'running'
        for over a week), so the folder does not grow forever. One bad file never stops the sweep."""
        if not self.slots_dir.is_dir():
            return
        finished_cutoff = time.time() - SLOT_PRUNE_DAYS * 86400
        running_cutoff = time.time() - SLOT_PRUNE_RUNNING_DAYS * 86400
        try:
            files = list(self.slots_dir.glob("*.json"))
        except OSError:
            return
        # Sweep abandoned temp files too. A kill -9 between write and os.replace leaves
        # <name>.<pid>.tmp behind for ever - the glob below only ever matched *.json.
        for d in (self.logs_dir, self.slots_dir):
            try:
                for t in d.glob("*.tmp"):
                    try:
                        if t.stat().st_mtime < finished_cutoff:
                            t.unlink()
                    except OSError:
                        continue
            except OSError:
                pass
        for f in files:
            try:
                if f == self.slot_file:
                    continue
                mtime = f.stat().st_mtime
                data = self._read_json(f, default={})
                running = isinstance(data, dict) and data.get("status") == "running"
                # 🔴 For a running slot, judge it by the timestamp INSIDE the file, not the file's
                # mtime. A long backfill that reports every few hours still has a recent
                # updatedAt, but its mtime can lag; deleting it made the run unresumable ("No run
                # in progress") and its completion silently unrecordable.
                if running:
                    stamp = _iso_seconds(data.get("updatedAt")) or mtime
                    if stamp < running_cutoff:
                        f.unlink()
                elif mtime < finished_cutoff:
                    f.unlink()
            except OSError:
                continue

    def _append_history(self, success, elapsed, summary):
        # Read-modify-write with a few retries: two scripts finishing in the same instant
        # can still race, which is a documented limit (one row could be lost, never corrupted).
        row = {
            "task": self.task_name,
            "date": _now_iso(),
            "success": success,
            "elapsed": round(elapsed, 1),
            "summary": summary,
            # 🔴 The TOTAL raised, not the number still held in memory. Every CLI subcommand is a
            # fresh process that rebuilds state from the (already trimmed) slot file, so counting
            # the survivors reported 20 for a run that raised 25 - the one number in the row whose
            # entire job is to be a count. `warningsTotal` is carried through the slot so it
            # survives the round trip.
            "warnings": max(int(getattr(self, "warnings_total", 0)), len(self.warnings)),
            "runId": self.run_id,
            "startedAt": self.started_at,
            # Capped. access.json correctly holds 150 nodes; the row it came from kept all 1,500,
            # then multiplied that by HISTORY_KEEP and rewrote the lot on every completion.
            "metrics": dict(list(self.metrics.items())[:MAX_METRICS]),
            "warningItems": self._warnings_for_history(),
            "accessed": list(self.accessed)[-MAX_ACCESSED:],
            "artifacts": list(self.artifacts)[-MAX_ARTIFACTS:],
        }
        if getattr(self, "user", ""):
            row["user"] = self.user
        if getattr(self, "commit", ""):
            row["commit"] = self.commit
        if getattr(self, "impacts", None):
            row["impacts"] = dict(self.impacts)
        if getattr(self, "category", ""):
            row["category"] = self.category
        last = None
        for attempt in range(3):
            history = self._read_json(self.history_file, default=[])
            if not isinstance(history, list):
                history = []
            history.append(row)
            try:
                self._write_json(self.history_file, history[-HISTORY_KEEP:])
                return
            except (OSError, ValueError) as e:
                # 🔴 Every OSError, not just PermissionError. complete() is called from __exit__,
                # so on a full disk ENOSPC escaped from here and REPLACED whatever exception the
                # script was actually failing with - the operator got "No space left on device"
                # where they needed the ValueError that broke their run.
                last = e
                time.sleep(0.05 * (attempt + 1))
        self._say(f"  NOTE: could not update {self.history_file.name} ({last.__class__.__name__}); run not recorded")

    def _warnings_for_slot(self):
        """
        Warnings to persist in the slot file.

        🔴 The slot is not just a display cache: every CLI subcommand runs in a NEW process and
        rebuilds its state by reading this back, so whatever is dropped here is gone for good —
        including from the history row written at the end. Capping it at the display limit meant
        a shell-driven run could never record more than 10 warnings, and an actionable finding
        raised early simply vanished. Actionable items are always kept; ordinary ones keep the
        most recent, up to the history limit rather than the display limit.
        """
        # Actionable items are kept in full - that is the point of the split - but "in full" has
        # a ceiling. The slot is rewritten on every warn(), so N actionable warnings cost O(N^2)
        # bytes over a run: 3,000 of them took 200 s and a 1.3 MB rewrite per call.
        actionable = [w for w in self.warnings if w.get("actionable")][-MAX_ACTIONABLE:]
        ordinary = [w for w in self.warnings if not w.get("actionable")][-WARNINGS_IN_HISTORY:]
        keep = {id(w) for w in actionable} | {id(w) for w in ordinary}
        return [w for w in self.warnings if id(w) in keep]

    def _warnings_for_history(self):
        """
        Warnings to keep in the history row.

        🔴 An ACTIONABLE warning is never dropped. The cap exists to stop a chatty script bloating
        the history file, but a chatty script is exactly the one whose findings matter, and the
        dashboard's Pending Actions list is built from this field — so truncating an actionable
        item silently retires a real finding and makes the dashboard claim nothing is outstanding.
        Ordinary warnings still yield to the cap; actionable ones are kept in full.
        """
        actionable = [w for w in self.warnings if w.get("actionable")][-MAX_ACTIONABLE:]
        ordinary = [w for w in self.warnings if not w.get("actionable")]
        kept = ordinary[-WARNINGS_IN_HISTORY:]
        # Preserve the original order rather than grouping by kind.
        keep_ids = {id(w) for w in kept} | {id(w) for w in actionable}
        return [w for w in self.warnings if id(w) in keep_ids]

    def _read_json(self, path: Path, default=None):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError, PermissionError):
            return default if default is not None else {}

    def _safe_write(self, path: Path, data, attempts=5, base=0.03):
        """Write, and if the disk refuses for longer than the retries, say so and carry on.
        The reporter must never be the reason the real job dies."""
        try:
            self._write_json(path, data, attempts=attempts, base=base)
        except (OSError, ValueError) as e:
            # ValueError as well as OSError: json.dumps raises it for a value it cannot serialise,
            # and this method's whole promise is that the reporter is never the reason a job dies.
            self._say(f"  NOTE: could not update {path.name} ({e.__class__.__name__}); continuing")

    def _write_json(self, path: Path, data, attempts=5, base=0.03):
        """Atomic write: the dashboard never sees a half-written file. The temp name carries the
        process id, so two scripts writing the same file at once never swap each other's bytes.

        🔴 `attempts`/`base` are the retry ladder, and the right ladder depends on what is being
        written. On Windows os.replace fails while ANY other process holds the destination open -
        a dashboard, a `tail`, an editor preview, an antivirus scan - so the full ladder is not a
        rare race but the normal cost of the tool doing its job. Measured: one held read handle
        turned a 0.85 ms call into 0.45 s, and then the write was discarded anyway.

        progress.json and the slot file are SUPERSEDED by the next call a second later, so they
        take a short, cheap ladder - losing one is invisible. The append-only files (history,
        deltas, impact, access) keep the patient one, because losing one of those loses data.
        """
        tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
        # 🔴 errors="replace" on the ENCODE side. A lone surrogate - which is what Linux gives you
        # for an undecodable filename (surrogateescape), and what Windows puts in some exception
        # messages - made json.dumps produce a str that UTF-8 cannot encode. That raised
        # UnicodeEncodeError, which is a ValueError, so neither _safe_write nor _write caught it:
        # the reporter took down the calling script, and in a `with` block it REPLACED the real
        # exception, so the operator saw a codec error instead of their own FileNotFoundError.
        text = json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False)
        tmp.write_bytes(text.encode("utf-8", errors="replace"))
        last_error = None
        for attempt in range(max(1, attempts)):
            try:
                os.replace(tmp, path)
                return
            except OSError as e:  # Windows: the reader (or another writer) has the file for a moment
                last_error = e
                time.sleep(base * (attempt + 1))
        try:
            tmp.unlink()
        except OSError:
            pass
        raise last_error

    @staticmethod
    def _fmt_duration(seconds):
        if seconds < 60:
            return f"{int(seconds)}s"
        m, s = divmod(int(seconds), 60)
        return f"{m}m{s}s"


def _print_status(logs_dir=None):
    """`python progress.py` - show what the dashboard would show, in the terminal."""
    d = resolve_logs_dir(logs_dir)
    p = d / "progress.json"
    if not p.exists():
        print(f"No progress.json in {d}")
        return 1
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as e:
        # Every other read in this file goes through _read_json and tolerates a torn or corrupt
        # file; this one printed a raw traceback for the exact case the tool exists to report on.
        print(f"Could not read {p}: {e.__class__.__name__}")
        return 1
    if not isinstance(data, dict):
        print(f"{p} does not contain a progress object")
        return 1
    upd = data.get("updatedAt", "")
    try:
        age = datetime.now() - datetime.fromisoformat(upd)
    except ValueError:
        age = timedelta(0)
    state = data.get("status", "?")
    if state == "running" and age > timedelta(minutes=30):
        state = "STALLED"
    print(f"{data.get('task')}  [{state}]  step {data.get('step')}/{data.get('totalSteps')}  {data.get('label')}")
    if data.get("detail"):
        print(f"  {data['detail']}")
    print(f"  elapsed {data.get('elapsed')}s  eta {data.get('eta')}  updated {upd}  ({int(age.total_seconds())}s ago)")
    for w in data.get("warnings", []):
        print(f"  WARNING {w.get('time','')} {w.get('msg','')}")
    for k, v in (data.get("metrics") or {}).items():
        print(f"  {k} = {v}")
    return 0


# ---------------------------------------------------------------------------- command line
#
# Why this exists: plenty of real work is not a Python script - a shell script, a scheduled
# task, an agent workflow, a Makefile. Without this, none of it can appear on the dashboard at
# all. Each command is a separate process, so the run is carried in its slot file rather than in
# memory: `start` creates it, every later command resumes it, `complete` closes it.
#
#   python progress.py start    "Nightly Load" [--total 4]
#   python progress.py step     "Nightly Load" 1 4 "Reading input"
#   python progress.py detail   "Nightly Load" "3,990 rows"
#   python progress.py substep  "Nightly Load" 0.5
#   python progress.py log      "Nightly Load" "first row looks sane"
#   python progress.py warn     "Nightly Load" "12 rows had no customer id"
#   python progress.py metric   "Nightly Load" rows_loaded 3990
#   python progress.py artifact "Nightly Load" output/report.xlsx
#   python progress.py delta    "Nightly Load" reconciliation_delta 0.0
#   python progress.py impact   "Nightly Load" corrections_found 1204.50 --label "Corrections"
#   python progress.py warn     "Nightly Load" "Section 6" --count 310 --category drift --actionable
#   python progress.py access   "Nightly Load" table sales.orders --mode write --detail "5 rows"
#   python progress.py complete "Nightly Load" --summary "INSERT: 3,990 rows"
#   python progress.py complete "Nightly Load" --fail --summary "source file missing" --category auth
#   python progress.py status                       # what the dashboard would show
#
# The task name can be left out of every command after `start` if PROGRESS_TASK is set:
#   export PROGRESS_TASK="Nightly Load"     (set PROGRESS_TASK=... on Windows)
#   python progress.py step 1 4 "Reading input"
# Passing it anyway still works, and --task "Nightly Load" is the explicit form.
# --logs DIR overrides the logs folder anywhere, as does PROGRESS_LOGS_DIR.
#
# Concurrency: a run is identified by its TASK NAME, so two runs sharing a name would fight over
# the same slot. If that can happen (two agents both running "Morning Scan"), capture the id and
# pass it back, and a displaced call fails loudly instead of writing into the other run:
#   RUN=$(python progress.py start "Morning Scan" --print-id)
#   python progress.py step --run "$RUN" 1 2 "Scanning"
#   python progress.py complete --run "$RUN" --summary "3 items"
# Better still, give concurrent runs distinct task names - they are the key for the calendar,
# history and ETA, so two things sharing one name are indistinguishable everywhere, not just here.
#
# Exit codes: 0 fine, 1 usage error, 2 no run to attach to. A reporting failure must never be
# the reason a job stops, so `complete` is forgiving: closing an already-closed run is not an error.

_COMMANDS = ("start", "step", "detail", "substep", "log", "warn", "metric",
             "artifact", "delta", "impact", "access", "complete", "status")


def _cli_usage(problem=""):
    if problem:
        print(f"progress.py: {problem}", file=sys.stderr)
    print(__doc__.split("Files written")[0].strip().splitlines()[0], file=sys.stderr)
    print("", file=sys.stderr)
    print("Commands: " + ", ".join(_COMMANDS), file=sys.stderr)
    print('Example:  python progress.py start "Nightly Load" --total 3', file=sys.stderr)
    print("Full reference: the command line section at the bottom of this file.", file=sys.stderr)
    return 1


def _take_flag(args, name, has_value=True):
    """Pull --name [value] out of args, returning the value (or True) and leaving the rest."""
    if name not in args:
        return None
    i = args.index(name)
    if not has_value:
        args.pop(i)
        return True
    if i + 1 >= len(args):
        # Remove the dangling flag anyway: leaving it behind put "--count" into the warning text.
        args.pop(i)
        return None
    args.pop(i)
    return args.pop(i)


def _cli(argv) -> int:
    args = list(argv)
    cmd = args.pop(0) if args else "status"
    if cmd in ("-h", "--help", "help"):
        return _cli_usage()
    if cmd not in _COMMANDS:
        return _cli_usage(f'unknown command "{cmd}"')

    logs_dir = _take_flag(args, "--logs")
    quiet = _take_flag(args, "--quiet", has_value=False) is not None
    run_id = _take_flag(args, "--run") or ""
    print_id = _take_flag(args, "--print-id", has_value=False) is not None

    if cmd == "status":
        return _print_status(logs_dir or (args[0] if args else None))

    # Which run are we talking about? --task wins; then PROGRESS_TASK; then the first
    # positional. When PROGRESS_TASK is set, a positional that repeats it is accepted and
    # skipped, so both documented forms work and neither silently eats a step number.
    task = _take_flag(args, "--task") or ""
    env_task = os.environ.get("PROGRESS_TASK", "")
    if not task:
        if env_task:
            task = env_task
            if args and args[0] == env_task:
                args.pop(0)
        elif args and not args[0].startswith("--"):
            task = args.pop(0)
    if not task:
        return _cli_usage("no task name given, and PROGRESS_TASK is not set")

    if cmd == "start":
        total = _take_flag(args, "--total")
        p = Progress(task, logs_dir=logs_dir, quiet=quiet)
        if total:
            try:
                p.current["total"] = int(total)
                p._write()
            except ValueError:
                pass
        if print_id:
            # Exactly the id and nothing else, so a script can capture it:
            #   RUN=$(python progress.py start "Nightly Load" --print-id)
            print(p.run_id)
        elif not quiet:
            print(f"[progress] started {task}  (run {p.run_id})")
        return 0

    try:
        p = Progress.resume(task, logs_dir=logs_dir, quiet=quiet, run_id=run_id)
    except LookupError as e:
        # `complete` on a run that is already closed is a no-op, not a failure: a shell script
        # with a trap should be able to call it unconditionally.
        # A `complete` on an already-closed run is a genuine no-op: a shell trap should be able
        # to call it unconditionally. But `complete --run <id>` naming a DISPLACED run is the one
        # case that must not be silent - it exits 0 having recorded nothing, which is precisely
        # the failure the --run guard exists to make loud for every other subcommand.
        if cmd == "complete" and not run_id:
            return 0
        print(f"progress.py: {e}", file=sys.stderr)
        return 2

    try:
        if cmd == "step":
            if len(args) < 3:
                return _cli_usage('step needs: <step> <total> "<label>"')
            p.step(int(args[0]), int(args[1]), " ".join(args[2:]))
        elif cmd == "detail":
            p.detail(" ".join(args))
        elif cmd == "substep":
            p.substep(float(args[0]))
        elif cmd == "log":
            p.log(" ".join(args))
        elif cmd == "warn":
            count = _take_flag(args, "--count")
            category = _take_flag(args, "--category") or ""
            severity = _take_flag(args, "--severity") or ""
            actionable = _take_flag(args, "--actionable", has_value=False) is not None
            p.warn(" ".join(args), count=count, category=category, severity=severity, actionable=actionable)
        elif cmd == "metric":
            if len(args) < 2:
                return _cli_usage("metric needs: <name> <value>")
            raw = " ".join(args[1:])
            try:
                value = _cli_number(raw)
            except ValueError:
                value = raw          # not a number at all: a short string metric is legitimate
            p.metric(args[0], value)
        elif cmd == "artifact":
            p.artifact(" ".join(args))
        elif cmd == "delta":
            if len(args) < 2:
                return _cli_usage("delta needs: <metric> <value>")
            try:
                p.track_delta(args[0], float(args[1]))
            except ValueError:
                return _cli_usage(f"delta needs a number, got {args[1]!r}")
        elif cmd == "impact":
            label = _take_flag(args, "--label") or ""
            if len(args) < 2:
                return _cli_usage('impact needs: <metric> <value> [--label "..."]')
            p.impact(args[0], float(args[1]), label=label)
        elif cmd == "access":
            mode = _take_flag(args, "--mode") or "read"
            detail = _take_flag(args, "--detail") or ""
            if len(args) < 2:
                return _cli_usage('access needs: <kind> <name> [--mode write] [--detail "..."]')
            p.access(args[0], " ".join(args[1:]), mode=mode, detail=detail)
        elif cmd == "complete":
            category = _take_flag(args, "--category") or ""
            summary = _take_flag(args, "--summary") or " ".join(args)
            failed = _take_flag(args, "--fail", has_value=False) is not None
            p.complete(success=not failed, summary=summary, category=category if failed else "")
    except (ValueError, IndexError) as e:
        return _cli_usage(f"{cmd}: {e}")
    return 0


if __name__ == "__main__":
    argv = sys.argv[1:]
    # Backwards compatible: `python progress.py` and `python progress.py <logsdir>` still print
    # the status, as they did before commands existed. A first argument that is neither a
    # command nor an existing folder is a typo, and saying so beats reporting that some
    # directory has no progress.json in it.
    if not argv:
        sys.exit(_print_status(None))
    if argv[0] not in _COMMANDS and not argv[0].startswith("-"):
        if Path(argv[0]).is_dir():
            sys.exit(_print_status(argv[0]))
        sys.exit(_cli_usage(f'unknown command "{argv[0]}" (and it is not a folder)'))
    sys.exit(_cli(argv))
