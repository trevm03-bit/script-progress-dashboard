# -*- coding: utf-8 -*-
"""Tests for progress.py. Run:  python python/test_progress.py   (stdlib unittest, no pip)."""
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from progress import Progress, resolve_logs_dir  # noqa: E402


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="spd-"))
        self.logs = self.tmp / "logs"
        self.out = io.StringIO()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def read(self, name):
        return json.loads((self.logs / name).read_text(encoding="utf-8"))

    def test_step_detail_warn_complete_write_expected_json(self):
        with redirect_stdout(self.out):
            p = Progress("Demo Task", logs_dir=self.logs)
            p.step(1, 3, "Reading")
            p.detail("Rows: 10")
            p.warn("one warning")
            prog = self.read("progress.json")
            self.assertEqual(prog["task"], "Demo Task")
            self.assertEqual(prog["status"], "running")
            self.assertEqual((prog["step"], prog["totalSteps"], prog["label"], prog["detail"]), (1, 3, "Reading", "Rows: 10"))
            self.assertEqual(len(prog["warnings"]), 1)
            self.assertIsNone(prog["eta"])          # no prior runs
            self.assertIn("updatedAt", prog)
            p.complete(success=True, summary="done")
        prog = self.read("progress.json")
        self.assertEqual(prog["status"], "complete")
        self.assertEqual(prog["label"], "Complete")
        hist = self.read("run_history.json")
        self.assertEqual(len(hist), 1)
        self.assertEqual(hist[0]["task"], "Demo Task")
        self.assertTrue(hist[0]["success"])
        self.assertEqual(hist[0]["warnings"], 1)
        self.assertEqual(hist[0]["summary"], "done")
        self.assertIn("[1/3] Reading", self.out.getvalue())
        self.assertIn("=== COMPLETE ===", self.out.getvalue())

    def test_eta_uses_prior_successful_runs_of_same_task(self):
        hist = [
            {"task": "A", "date": "2026-01-01T00:00:00", "success": True, "elapsed": 100.0, "summary": "", "warnings": 0},
            {"task": "A", "date": "2026-01-02T00:00:00", "success": False, "elapsed": 5.0, "summary": "", "warnings": 0},
            {"task": "B", "date": "2026-01-03T00:00:00", "success": True, "elapsed": 999.0, "summary": "", "warnings": 0},
            {"task": "A", "date": "2026-01-04T00:00:00", "success": True, "elapsed": 200.0, "summary": "", "warnings": 0},
        ]
        self.logs.mkdir(parents=True)
        (self.logs / "run_history.json").write_text(json.dumps(hist), encoding="utf-8")
        with redirect_stdout(self.out):
            p = Progress("A", logs_dir=self.logs)
        prog = self.read("progress.json")
        # avg of 100 and 200 = 150, minus ~0 elapsed
        self.assertAlmostEqual(prog["eta"], 150.0, delta=1.0)

    def test_context_manager_reports_crash_as_failure(self):
        with redirect_stdout(self.out):
            with self.assertRaises(ValueError):
                with Progress("Crashy", logs_dir=self.logs) as p:
                    p.step(1, 2, "About to fail")
                    raise ValueError("boom")
        prog = self.read("progress.json")
        self.assertEqual(prog["status"], "failed")
        self.assertIn("boom", prog["detail"])
        hist = self.read("run_history.json")
        self.assertFalse(hist[0]["success"])
        self.assertIn("boom", hist[0]["summary"])

    def test_context_manager_completes_cleanly_when_not_completed_explicitly(self):
        with redirect_stdout(self.out):
            with Progress("Tidy", logs_dir=self.logs) as p:
                p.step(1, 1, "Only step")
                p.detail("all good")
        self.assertEqual(self.read("progress.json")["status"], "complete")
        self.assertEqual(self.read("run_history.json")[0]["summary"], "all good")

    def test_history_is_capped(self):
        with redirect_stdout(self.out):
            for i in range(105):
                Progress("Loop", logs_dir=self.logs).complete(True, str(i))
        hist = self.read("run_history.json")
        self.assertEqual(len(hist), 100)
        self.assertEqual(hist[-1]["summary"], "104")
        self.assertEqual(hist[0]["summary"], "5")

    def test_track_delta_appends_and_caps(self):
        with redirect_stdout(self.out):
            p = Progress("D", logs_dir=self.logs)
            for i in range(55):
                p.track_delta("m", i)
            p.track_delta("other", 1.5)
        d = self.read("deltas.json")
        self.assertEqual(len(d["m"]), 50)
        self.assertEqual(d["m"][-1]["value"], 54)
        self.assertEqual(d["other"][0]["value"], 1.5)
        self.assertEqual(d["other"][0]["task"], "D")

    def test_access_builds_graph_and_marks_progress(self):
        with redirect_stdout(self.out):
            p = Progress("Loader", logs_dir=self.logs)
            p.access("file", "input/orders.csv")
            p.access("table", "sales.orders", mode="write")
            p.access("table", "sales.orders", mode="write")   # same edge: count -> 2
            p.access("weird-kind", "thing")                    # unknown kind -> other
        g = self.read("access.json")
        ids = {n["id"] for n in g["nodes"]}
        self.assertEqual(ids, {"task:Loader", "file:input/orders.csv", "table:sales.orders", "other:thing"})
        write_edge = [e for e in g["edges"] if e["to"] == "table:sales.orders"][0]
        self.assertEqual(write_edge["count"], 2)
        self.assertEqual(write_edge["mode"], "write")
        prog = self.read("progress.json")
        self.assertEqual(prog["accessed"], ["file:input/orders.csv", "table:sales.orders", "other:thing"])

    def test_access_caps_resource_nodes_but_keeps_tasks(self):
        with redirect_stdout(self.out):
            p = Progress("Big", logs_dir=self.logs)
            for i in range(160):
                p.access("file", f"f{i}")
        g = self.read("access.json")
        self.assertEqual(len(g["nodes"]), 150)
        self.assertIn("task:Big", {n["id"] for n in g["nodes"]})
        for e in g["edges"]:
            self.assertIn(e["to"], {n["id"] for n in g["nodes"]})

    def test_writes_are_atomic_and_leave_no_tmp(self):
        with redirect_stdout(self.out):
            p = Progress("Atomic", logs_dir=self.logs)
            p.step(1, 1, "x")
            p.complete()
        leftovers = [f.name for f in self.logs.iterdir() if f.name.endswith(".tmp")]
        self.assertEqual(leftovers, [])

    def test_bad_existing_files_are_tolerated(self):
        self.logs.mkdir(parents=True)
        (self.logs / "run_history.json").write_text("{not json", encoding="utf-8")
        (self.logs / "deltas.json").write_text("[]", encoding="utf-8")   # wrong shape
        with redirect_stdout(self.out):
            p = Progress("Tolerant", logs_dir=self.logs)
            p.track_delta("m", 1)
            p.complete()
        self.assertEqual(len(self.read("run_history.json")), 1)
        self.assertEqual(self.read("deltas.json")["m"][0]["value"], 1)

    def test_non_ascii_survives(self):
        with redirect_stdout(self.out):
            p = Progress("Unicode – ünïcode", logs_dir=self.logs)
            p.warn("café ✓")
            p.complete(True, "Σ = 3")
        self.assertEqual(self.read("progress.json")["warnings"][0]["msg"], "café ✓")
        self.assertEqual(self.read("run_history.json")[0]["summary"], "Σ = 3")

    # ---- logs folder resolution --------------------------------------------------------
    def test_resolve_explicit_arg_wins(self):
        self.assertEqual(resolve_logs_dir("C:/x/logs"), Path("C:/x/logs"))

    def test_resolve_env_var(self):
        old = os.environ.get("PROGRESS_LOGS_DIR")
        os.environ["PROGRESS_LOGS_DIR"] = str(self.tmp / "envlogs")
        try:
            self.assertEqual(resolve_logs_dir(None), self.tmp / "envlogs")
        finally:
            if old is None:
                del os.environ["PROGRESS_LOGS_DIR"]
            else:
                os.environ["PROGRESS_LOGS_DIR"] = old

    def test_resolve_walks_up_from_scripts_lib_to_project_logs(self):
        """The spec's original default pointed at scripts/logs; the real logs folder is one level up."""
        old = os.environ.pop("PROGRESS_LOGS_DIR", None)
        try:
            project = self.tmp / "project"
            (project / "logs").mkdir(parents=True)
            lib = project / "scripts" / "lib"
            lib.mkdir(parents=True)
            module_file = lib / "progress.py"
            shutil.copy(HERE / "progress.py", module_file)
            self.assertEqual(resolve_logs_dir(None, module_file=str(module_file)), project / "logs")
            # and via .git when logs/ does not exist yet
            project2 = self.tmp / "project2"
            (project2 / ".git").mkdir(parents=True)
            lib2 = project2 / "scripts" / "lib"
            lib2.mkdir(parents=True)
            self.assertEqual(resolve_logs_dir(None, module_file=str(lib2 / "progress.py")), project2 / "logs")
        finally:
            if old is not None:
                os.environ["PROGRESS_LOGS_DIR"] = old

    def test_module_imports_from_copied_location(self):
        """Simulates the real install: copy to <project>/scripts/lib and import it from there."""
        project = self.tmp / "proj"
        lib = project / "scripts" / "lib"
        lib.mkdir(parents=True)
        (project / "logs").mkdir()
        shutil.copy(HERE / "progress.py", lib / "progress.py")
        spec = importlib.util.spec_from_file_location("copied_progress", lib / "progress.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        old = os.environ.pop("PROGRESS_LOGS_DIR", None)
        try:
            with redirect_stdout(self.out):
                p = mod.Progress("Copied")
                p.complete()
            self.assertTrue((project / "logs" / "progress.json").exists())
        finally:
            if old is not None:
                os.environ["PROGRESS_LOGS_DIR"] = old


if __name__ == "__main__":
    unittest.main(verbosity=2)
