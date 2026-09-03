# -*- coding: utf-8 -*-
"""
Script Progress Dashboard - Python reporter.

Drop this file into your project (for example scripts/lib/progress.py) and call it from any
long-running script. It writes small JSON files that the VS Code extension watches. Nothing
here needs the internet or any package outside the standard library.

Usage:
    from lib.progress import Progress

    with Progress("Nightly Load") as p:            # 'with' = auto-reports a crash as FAILED
        p.step(1, 3, "Reading input file")
        p.access("file", "input/orders.csv")       # optional: feeds the Access Map
        p.detail("Rows: 3,990")
        p.step(2, 3, "Loading warehouse table")
        p.access("table", "sales.orders", mode="write")
        p.warn("12 rows had no customer id")
        p.step(3, 3, "Reconciling")
        p.track_delta("reconciliation_delta", 0.0) # optional: feeds the Delta Tracker
        p.complete(success=True, summary="INSERT: 3,990 rows")

Files written (all in the logs folder, see below):
    progress.json      the current task - the extension's status bar and Active Task panel
    run_history.json   one row per completed run (last 100)
    deltas.json        numeric series for the Delta Tracker (last 50 points per metric)
    access.json        scripts -> resources graph for the Access Map (last 150 nodes)

Where the logs folder is, in order of preference:
    1. the logs_dir argument,
    2. the PROGRESS_LOGS_DIR environment variable,
    3. the first parent folder of THIS file that contains a 'logs' folder or a '.git' folder,
       plus '/logs'  (so scripts/lib/progress.py -> <project>/logs),
    4. ./logs under the current working directory.
"""
import json
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

__all__ = ["Progress", "resolve_logs_dir"]

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
PRIOR_RUNS_FOR_ETA = 5


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


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
    def __init__(self, task_name: str, logs_dir=None):
        self.task_name = task_name
        self.logs_dir = resolve_logs_dir(logs_dir)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.progress_file = self.logs_dir / "progress.json"
        self.history_file = self.logs_dir / "run_history.json"
        self.deltas_file = self.logs_dir / "deltas.json"
        self.access_file = self.logs_dir / "access.json"
        self.start_time = time.time()
        self.warnings = []
        self.accessed = []            # node ids touched this run, in order
        self.completed = False
        self.current = {"step": 0, "total": 0, "label": "Starting", "detail": ""}
        self._prior_durations = self._get_prior_durations()
        self._write()

    # ------------------------------------------------------------------ reporting API
    def step(self, step_num: int, total_steps: int, label: str):
        """Move to a new step. Prints it too, so the terminal shows the same story."""
        self.current = {"step": int(step_num), "total": int(total_steps), "label": str(label), "detail": ""}
        self._write()
        print(f"\n[{step_num}/{total_steps}] {label}...")

    def detail(self, text: str):
        """Update the detail line under the current step (row counts, file names...)."""
        self.current["detail"] = str(text)
        self._write()
        print(f"  {text}")

    def warn(self, message: str):
        """Record a warning. Shows up in the dashboard and counts in run history."""
        self.warnings.append({"time": _now_iso(), "msg": str(message)})
        self._write()
        print(f"  WARNING: {message}")

    def track_delta(self, metric_name: str, value: float):
        """Append one numeric value to a named series for the Delta Tracker sparkline."""
        deltas = self._read_json(self.deltas_file, default={})
        if not isinstance(deltas, dict):
            deltas = {}
        series = deltas.setdefault(metric_name, [])
        series.append({"date": _now_iso(), "value": float(value), "task": self.task_name})
        deltas[metric_name] = series[-DELTA_KEEP:]
        self._write_json(self.deltas_file, deltas)

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
        node_list = sorted(nodes.values(), key=lambda n: (n.get("type") != "task", n.get("lastSeen", "")), reverse=False)
        tasks = [n for n in node_list if n.get("type") == "task"]
        resources = sorted([n for n in node_list if n.get("type") != "task"], key=lambda n: n.get("lastSeen", ""), reverse=True)
        keep = tasks + resources[: max(0, ACCESS_NODE_KEEP - len(tasks))]
        keep_ids = {n["id"] for n in keep}
        edges = [e for e in edges if e.get("from") in keep_ids and e.get("to") in keep_ids]

        self._write_json(self.access_file, {"nodes": keep, "edges": edges})
        if res_id not in self.accessed:
            self.accessed.append(res_id)
            self._write()

    def complete(self, success: bool = True, summary: str = ""):
        """Mark the run finished and add it to run history. Called for you by 'with'."""
        if self.completed:
            return
        self.completed = True
        elapsed = time.time() - self.start_time
        self.current["label"] = "Complete" if success else "FAILED"
        self.current["detail"] = str(summary)
        self._write(status="complete" if success else "failed")
        self._append_history(bool(success), elapsed, str(summary))
        status = "COMPLETE" if success else "FAILED"
        print(f"\n=== {status} === ({self._fmt_duration(elapsed)})")
        if summary:
            print(f"  {summary}")

    # ------------------------------------------------------------------ context manager
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

    # ------------------------------------------------------------------ internals
    def _write(self, status="running"):
        elapsed = time.time() - self.start_time
        data = {
            "task": self.task_name,
            "status": status,
            "step": self.current["step"],
            "totalSteps": self.current["total"],
            "label": self.current["label"],
            "detail": self.current["detail"],
            "elapsed": round(elapsed, 1),
            "eta": self._estimate_eta(elapsed) if status == "running" else None,
            "warnings": self.warnings[-WARNINGS_IN_PROGRESS:],
            "accessed": list(self.accessed),
            "updatedAt": _now_iso(),
        }
        self._write_json(self.progress_file, data)

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

    def _append_history(self, success, elapsed, summary):
        # Read-modify-write with a few retries: two scripts finishing in the same instant
        # can still race, which is a documented limit (one row could be lost, never corrupted).
        for attempt in range(3):
            history = self._read_json(self.history_file, default=[])
            if not isinstance(history, list):
                history = []
            history.append({
                "task": self.task_name,
                "date": _now_iso(),
                "success": success,
                "elapsed": round(elapsed, 1),
                "summary": summary,
                "warnings": len(self.warnings),
            })
            try:
                self._write_json(self.history_file, history[-HISTORY_KEEP:])
                return
            except PermissionError:
                time.sleep(0.05 * (attempt + 1))
        # Last resort so the run is never lost silently.
        print(f"  NOTE: could not update {self.history_file.name} (file busy); run not recorded")

    def _read_json(self, path: Path, default=None):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError, PermissionError):
            return default if default is not None else {}

    def _write_json(self, path: Path, data):
        """Atomic write: the dashboard never sees a half-written file."""
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        last_error = None
        for attempt in range(5):
            try:
                os.replace(tmp, path)
                return
            except PermissionError as e:  # Windows: the reader has the file open for a moment
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
