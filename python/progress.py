# -*- coding: utf-8 -*-
"""
Script Progress Dashboard - Python reporter (v1.1).

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

Also:
    @Progress.wrap("Nightly Load")                 # decorator form: wraps a function in a run
    def main(p): ...

    python progress.py                             # prints the current status (no arguments)

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
import re
import sys
import time
import traceback
import uuid
from datetime import datetime, timedelta
from pathlib import Path

__all__ = ["Progress", "resolve_logs_dir"]
__version__ = "1.1.0"

# Windows consoles default to cp1252; a stray non-ASCII character in a summary must never
# crash the script that is doing the real work.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:  # pragma: no cover - extremely defensive
        pass

HISTORY_KEEP = 100
DELTA_KEEP = 50
ACCESS_NODE_KEEP = 150
WARNINGS_IN_PROGRESS = 10
WARNINGS_IN_HISTORY = 20
LOG_KEEP = 20
PRIOR_RUNS_FOR_ETA = 5
SLOT_PRUNE_DAYS = 2
SLOT_PRUNE_RUNNING_DAYS = 7


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s[:60] or "task"


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


class Progress:
    def __init__(self, task_name: str, logs_dir=None, quiet: bool = False):
        self.task_name = task_name
        self.quiet = quiet
        self.logs_dir = resolve_logs_dir(logs_dir)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.slots_dir = self.logs_dir / "progress"
        self.progress_file = self.logs_dir / "progress.json"
        self.slot_file = self.slots_dir / (_slug(task_name) + ".json")
        self.history_file = self.logs_dir / "run_history.json"
        self.deltas_file = self.logs_dir / "deltas.json"
        self.access_file = self.logs_dir / "access.json"
        self.run_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        self.start_time = time.time()
        self.started_at = _now_iso()
        self.warnings = []
        self.log_lines = []
        self.metrics = {}
        self.artifacts = []
        self.accessed = []            # node ids touched this run, in order
        self.completed = False
        self.current = {"step": 0, "total": 0, "label": "Starting", "detail": "", "substep": None}
        self._prior_durations = self._get_prior_durations()
        self._prune_slots()
        self._write()

    # ------------------------------------------------------------------ reporting API
    def step(self, step_num: int, total_steps: int, label: str):
        """Move to a new step. Prints it too, so the terminal shows the same story."""
        self.current = {"step": int(step_num), "total": int(total_steps), "label": str(label), "detail": "", "substep": None}
        self._write()
        self._say(f"\n[{step_num}/{total_steps}] {label}...")

    def detail(self, text: str):
        """Update the detail line under the current step (row counts, file names...)."""
        self.current["detail"] = str(text)
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

    def warn(self, message: str):
        """Record a warning. Shows up in the dashboard and counts in run history."""
        self.warnings.append({"time": _now_iso(), "msg": str(message)})
        self._write()
        self._say(f"  WARNING: {message}")

    def metric(self, name: str, value):
        """Record a named metric for this run (number or short string). Shown as a card, kept in history."""
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            value = str(value)
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
        series = deltas.setdefault(metric_name, [])
        series.append({"date": _now_iso(), "value": v, "task": self.task_name})
        deltas[metric_name] = series[-DELTA_KEEP:]
        self._safe_write(self.deltas_file, deltas)

    def access(self, kind: str, name: str, mode: str = "read"):
        """
        Record that this task touched a resource, for the Access Map.
            kind: 'file' | 'table' | 'api' | 'other'
            name: anything readable, e.g. 'input/orders.csv', 'sales.orders', 'CRM REST'
            mode: 'read' (default) or 'write'
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
        for e in edges:
            if e.get("from") == task_id and e.get("to") == res_id and e.get("mode") == mode:
                e["count"] = int(e.get("count", 0)) + 1
                e["lastSeen"] = now
                break
        else:
            edges.append({"from": task_id, "to": res_id, "mode": mode, "count": 1, "lastSeen": now})

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

    def complete(self, success: bool = True, summary: str = "", metrics: dict = None):
        """Mark the run finished and add it to run history. Called for you by 'with'."""
        if self.completed:
            return
        if metrics:
            for k, v in dict(metrics).items():
                self.metric(k, v)
        self.completed = True
        elapsed = time.time() - self.start_time
        self.current["label"] = "Complete" if success else "FAILED"
        self.current["detail"] = str(summary)
        self.current["substep"] = None
        self._write(status="complete" if success else "failed")
        self._append_history(bool(success), elapsed, str(summary))
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
            self.complete(success=False, summary=f"Unhandled error: {first_line}")
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
            "warnings": self.warnings[-WARNINGS_IN_PROGRESS:],
            "log": self.log_lines[-LOG_KEEP:],
            "metrics": dict(self.metrics),
            "artifacts": list(self.artifacts),
            "accessed": list(self.accessed),
            "runId": self.run_id,
            "startedAt": self.started_at,
            "updatedAt": _now_iso(),
        }
        self._safe_write(self.progress_file, data)
        try:
            self.slots_dir.mkdir(parents=True, exist_ok=True)
            self._write_json(self.slot_file, data)
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
        return [
            float(r["elapsed"])
            for r in history
            if isinstance(r, dict) and r.get("task") == self.task_name and r.get("success") and "elapsed" in r
        ][-PRIOR_RUNS_FOR_ETA:]

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
        for f in files:
            try:
                if f == self.slot_file:
                    continue
                mtime = f.stat().st_mtime
                data = self._read_json(f, default={})
                running = isinstance(data, dict) and data.get("status") == "running"
                if (not running and mtime < finished_cutoff) or (running and mtime < running_cutoff):
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
            "warnings": len(self.warnings),
            "runId": self.run_id,
            "startedAt": self.started_at,
            "metrics": dict(self.metrics),
            "warningItems": self.warnings[-WARNINGS_IN_HISTORY:],
            "accessed": list(self.accessed),
            "artifacts": list(self.artifacts),
        }
        for attempt in range(3):
            history = self._read_json(self.history_file, default=[])
            if not isinstance(history, list):
                history = []
            history.append(row)
            try:
                self._write_json(self.history_file, history[-HISTORY_KEEP:])
                return
            except PermissionError:
                time.sleep(0.05 * (attempt + 1))
        self._say(f"  NOTE: could not update {self.history_file.name} (file busy); run not recorded")

    def _read_json(self, path: Path, default=None):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError, PermissionError):
            return default if default is not None else {}

    def _safe_write(self, path: Path, data):
        """Write, and if the disk refuses for longer than the retries, say so and carry on.
        The reporter must never be the reason the real job dies."""
        try:
            self._write_json(path, data)
        except OSError as e:
            self._say(f"  NOTE: could not update {path.name} ({e.__class__.__name__}); continuing")

    def _write_json(self, path: Path, data):
        """Atomic write: the dashboard never sees a half-written file. The temp name carries the
        process id, so two scripts writing the same file at once never swap each other's bytes."""
        tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        last_error = None
        for attempt in range(5):
            try:
                os.replace(tmp, path)
                return
            except OSError as e:  # Windows: the reader (or another writer) has the file for a moment
                last_error = e
                time.sleep(0.03 * (attempt + 1))
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
    data = json.loads(p.read_text(encoding="utf-8"))
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


if __name__ == "__main__":
    sys.exit(_print_status(sys.argv[1] if len(sys.argv) > 1 else None))
