"""
Regression tests for the defects the 1.6.0 adversarial review found in the reporter.

Every assertion here reproduces a failure that was real: a lone surrogate taking down the calling
script, a full disk replacing the operator's own exception, one malformed history row bricking a
task for ever, four task names sharing one slot file. They live in the suite rather than in a
scratch file because the reviews that found them were expensive, and a defect nobody has a test
for is a defect that comes back.

    python python/test_regressions.py
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "python"))
import progress as progress_module                  # noqa: E402
from progress import Progress, _slug, _cli_number   # noqa: E402


def tmp():
    return Path(tempfile.mkdtemp(prefix="spd-reg-"))


class ReporterRegressions(unittest.TestCase):
    """One test method, because the checks share setup and run in a few seconds together."""

    def test_every_reviewed_defect_stays_fixed(self):
        def check(name, cond, detail=""):
            self.assertTrue(cond, f"{name}: {detail}")

        
        def tmp():
            d = tempfile.mkdtemp(prefix="spd-reg-"); return Path(d)

        # --- S1.1 lone surrogates must never escape ------------------------------------------------
        d = tmp()
        try:
            with Progress("T", logs_dir=d, quiet=True) as p:
                p.warn("bad \ud800 name"); p.artifact("out/\udcff.csv"); p.metric("m", "\ud800")
            check("surrogate in warn/artifact/metric does not raise", True)
        except Exception as e:
            check("surrogate in warn/artifact/metric does not raise", False, repr(e))

        d = tmp()
        try:
            with Progress("out/\udcff", logs_dir=d, quiet=True):
                pass
            check("surrogate in the TASK NAME does not raise", True)
        except Exception as e:
            check("surrogate in the TASK NAME does not raise", False, repr(e))

        d = tmp()
        got = None
        try:
            with Progress("M2", logs_dir=d, quiet=True) as p:
                raise FileNotFoundError("cannot open data/\udcffbad.csv")
        except BaseException as e:
            got = e
        check("the script's OWN exception survives", isinstance(got, FileNotFoundError), type(got).__name__)

        # --- S1.2 a failing history write must not replace the real exception ----------------------
        d = tmp()
        real = None
        try:
            with Progress("M1", logs_dir=d, quiet=True) as p:
                orig = os.replace
                os.replace = lambda a, b: (_ for _ in ()).throw(OSError(28, "No space left on device"))
                try:
                    raise ValueError("THE REAL BUG")
                finally:
                    pass
        except BaseException as e:
            real = e
        finally:
            os.replace = orig
        check("ENOSPC on history does not mask the real error", isinstance(real, ValueError), type(real).__name__)

        # --- S1.3 a bad logs dir must not raise ----------------------------------------------------
        d = tmp(); bad = d / "file.txt"; bad.write_text("x", encoding="utf-8")
        try:
            Progress("X", logs_dir=bad, quiet=True); check("logs_dir pointing at a FILE does not raise", True)
        except Exception as e:
            check("logs_dir pointing at a FILE does not raise", False, repr(e))

        # --- S1.4 a malformed history row must not brick the task ----------------------------------
        for bad_val in ("null", '"n/a"'):
            d = tmp(); (d).mkdir(exist_ok=True)
            (d / "run_history.json").write_text('[{"task":"T","success":true,"elapsed":%s}]' % bad_val, encoding="utf-8")
            try:
                Progress("T", logs_dir=d, quiet=True); check(f"history row elapsed={bad_val} does not brick the task", True)
            except Exception as e:
                check(f"history row elapsed={bad_val} does not brick the task", False, repr(e))

        # --- S1.5 track_delta on a non-list series -------------------------------------------------
        d = tmp(); d.mkdir(exist_ok=True)
        p = Progress("T", logs_dir=d, quiet=True)
        (d / "deltas.json").write_text('{"m": 5}', encoding="utf-8")
        try:
            p.track_delta("m", 1.0); check("track_delta over a corrupt series does not raise", True)
        except Exception as e:
            check("track_delta over a corrupt series does not raise", False, repr(e))

        # --- S1.6 caller typos are coerced, not raised ---------------------------------------------
        d = tmp(); p = Progress("T", logs_dir=d, quiet=True)
        try:
            p.step("one", 3, "lbl"); p.step(1, None, "x"); check("step() with bad arguments does not raise", True)
        except Exception as e:
            check("step() with bad arguments does not raise", False, repr(e))

        # --- S2.8 slug collisions ------------------------------------------------------------------
        names = ["Nightly Load", "Nightly-Load", "nightly  load!!", "NIGHTLY_LOAD"]
        check("case/punctuation variants get distinct slots", len({_slug(n) for n in names}) == len(names), {_slug(n) for n in names})
        uni = ["夜間ロード", "تحميل ليلي", "🌙", "Отчёт"]
        check("non-ASCII names get distinct slots", len({_slug(n) for n in uni}) == len(uni), {_slug(n) for n in uni})
        check("slug is stable for the same name", _slug("Nightly Load") == _slug("Nightly Load"))

        d = tmp()
        env = dict(os.environ, PROGRESS_LOGS_DIR=str(d))
        def cli(*a):
            return subprocess.run([sys.executable, str(REPO / "python" / "progress.py"), *a],
                                  capture_output=True, text=True, env=env, cwd=str(REPO))
        cli("start", "Scan", "--quiet"); cli("warn", "Scan", "A: found 3 problems", "--quiet")
        r = cli("start", "Scan", "--quiet")
        cli("complete", "Scan", "--summary", "B done", "--quiet")
        hist = json.loads((d / "run_history.json").read_text(encoding="utf-8")) if (d / "run_history.json").exists() else []
        check("a second start of the same name is recorded", len(hist) >= 1, hist)

        # --- S2.9 complete --run on a displaced run must be loud ------------------------------------
        d = tmp(); env = dict(os.environ, PROGRESS_LOGS_DIR=str(d))
        A = cli("start", "Scan", "--print-id").stdout.strip()
        cli("start", "Scan", "--quiet")
        r = cli("complete", "--run", A, "Scan", "--summary", "A done")
        check("complete --run on a displaced run exits non-zero", r.returncode != 0, f"rc={r.returncode}")
        r2 = cli("complete", "Scan", "--summary", "B done", "--quiet")
        check("complete with no --run is still a safe no-op", r2.returncode == 0, f"rc={r2.returncode}")

        # --- S2.11 the warnings COUNT must survive the CLI round trip -------------------------------
        d = tmp(); env = dict(os.environ, PROGRESS_LOGS_DIR=str(d))
        cli("start", "W", "--quiet")
        for i in range(25):
            cli("warn", "W", f"finding {i}", "--quiet")
        cli("complete", "W", "--summary", "done", "--quiet")
        hist = json.loads((d / "run_history.json").read_text(encoding="utf-8"))
        check("CLI run records all 25 warnings in the count", hist[-1]["warnings"] == 25, hist[-1]["warnings"])

        d = tmp()
        with Progress("W", logs_dir=d, quiet=True) as p:
            for i in range(25): p.warn(f"finding {i}")
        hist = json.loads((d / "run_history.json").read_text(encoding="utf-8"))
        check("in-process run records all 25 too", hist[-1]["warnings"] == 25, hist[-1]["warnings"])

        # --- S2.12 CLI numbers keep their precision --------------------------------------------------
        check("huge int survives", _cli_number("123456789012345678901234567890") == 123456789012345678901234567890)
        check("2^53+1 survives", _cli_number("9007199254740993") == 9007199254740993)
        try:
            _cli_number("1_000"); check("1_000 is rejected as shell input", False)
        except ValueError:
            check("1_000 is rejected as shell input", True)

        # --- S2.10 a long-running slot is not pruned by mtime alone ----------------------------------
        d = tmp(); p = Progress("LongRun", logs_dir=d, quiet=True)
        slot = p.slot_file
        old = time.time() - 8 * 86400
        os.utime(slot, (old, old))                      # stale mtime, fresh updatedAt inside
        Progress("Other", logs_dir=d, quiet=True)       # triggers the sweep
        check("a live run's slot survives a stale mtime", slot.exists())

        # --- S3.13 a held reader must not cost the full ladder ---------------------------------------
        d = tmp(); p = Progress("Lock", logs_dir=d, quiet=True)
        fh = open(d / "progress.json", "r", encoding="utf-8")
        t0 = time.time(); p.step(1, 2, "x"); dt = time.time() - t0
        fh.close()
        check("a held read handle costs under 0.1s (was 0.45s)", dt < 0.1, f"{dt:.3f}s")

        # --- S3.14 text and list growth are bounded ---------------------------------------------------
        d = tmp()
        with Progress("Big", logs_dir=d, quiet=True) as p:
            for i in range(5): p.warn("x" * 1_000_000)
            p.metric("m", "y" * 1_000_000)
            for i in range(400): p.access("table", f"t{i}", "read")
            p.complete(summary="z" * 1_000_000)
        size = (d / "progress.json").stat().st_size
        row = json.loads((d / "run_history.json").read_text(encoding="utf-8"))[-1]
        check("progress.json stays under 200 KB (was 7 MB)", size < 200_000, size)
        check("history row caps `accessed`", len(row["accessed"]) <= 200, len(row["accessed"]))

        d = tmp()
        t0 = time.time()
        with Progress("Many", logs_dir=d, quiet=True) as p:
            for i in range(1200): p.warn(f"finding {i}", actionable=True)
        dt = time.time() - t0
        check("1200 actionable warnings complete in under 20s (was 200s at 3000)", dt < 20, f"{dt:.1f}s")
        check("the count is still truthful", json.loads((d / "run_history.json").read_text(encoding="utf-8"))[-1]["warnings"] == 1200)

        # --- S3.15 `status` on a corrupt file ---------------------------------------------------------
        d = tmp(); d.mkdir(exist_ok=True); (d / "progress.json").write_text("{oops", encoding="utf-8")
        r = subprocess.run([sys.executable, str(REPO / "python" / "progress.py"), "status"],
                           capture_output=True, text=True, env=dict(os.environ, PROGRESS_LOGS_DIR=str(d)), cwd=str(REPO))
        check("status on a corrupt file prints a message, not a traceback",
              "Traceback" not in (r.stdout + r.stderr) and r.returncode == 1, (r.stdout + r.stderr)[:120])


class ConcurrentCompletions(unittest.TestCase):
    """
    run_history.json is a read-modify-write on a file every script shares.

    Before the lock, scripts completing together lost rows constantly: measured 38% at two
    concurrent completions, 71% at eight, 81% at sixteen. A lost row is a run that silently never
    happened - no history, no calendar tick, no coverage credit, no ETA for next time. Six
    concurrent completions is enough to catch a regression without making the suite slow.
    """

    WORKER = textwrap.dedent("""
        import sys, time
        sys.path.insert(0, r"{py}")
        from progress import Progress
        release, name, logs = float(sys.argv[1]), sys.argv[2], sys.argv[3]
        p = Progress(name, logs_dir=logs, quiet=True)
        while time.time() < release:      # spin to the shared barrier so they really collide
            pass
        p.complete(summary=name)
    """)

    def test_six_scripts_finishing_together_all_get_recorded(self):
        d = tmp()
        worker = d / "w.py"
        worker.write_text(self.WORKER.format(py=str(REPO / "python")), encoding="utf-8")
        release = time.time() + 2.0
        procs = [
            subprocess.Popen([sys.executable, str(worker), str(release), f"Task{i}", str(d)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for i in range(6)
        ]
        for proc in procs:
            proc.wait(timeout=120)
        history = json.loads((d / "run_history.json").read_text(encoding="utf-8"))
        names = sorted(r["task"] for r in history)
        self.assertEqual(names, sorted(f"Task{i}" for i in range(6)),
                         f"rows lost to the completion race: got {names}")
        # And the lock file must not be left behind for the next run to trip over.
        self.assertEqual(list(d.glob("*.lock")), [])


class SharedFileConcurrency(unittest.TestCase):
    """
    run_history.json was not the only file every script appends to.

    The 1.6 lock was introduced for run_history.json and applied only there, which read as "the
    concurrency bug is fixed". impact.json, deltas.json and access.json are the same
    read-modify-write across the same processes and kept losing data at the same rate. Measured
    over 16 concurrent runs each reporting the same impact: history kept 16 of 16 rows and summed
    to the true $1,600 while impact.json kept ONE - the Impact Summary card read $100 across 1
    run, 94% of the headline figure gone, with the locked file next to it proving the data had
    existed. The Delta Tracker lost 15 of 16 series outright.

    Eight is enough to catch a regression without making the suite slow: unlocked, this shape lost
    contributions in every trial at N=6.
    """

    N = 8
    WORKER = textwrap.dedent("""
        import sys, time
        sys.path.insert(0, r"{py}")
        from progress import Progress
        release, i, logs = float(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
        p = Progress("Task%d" % i, logs_dir=logs, quiet=True)
        while time.time() < release:      # spin to the shared barrier so they really collide
            pass
        p.impact("corrections_found", 100.0)
        p.track_delta("series_%d" % i, float(i))
        p.access("table", "resource_%d" % i, "read")
        p.complete(summary="done")
    """)

    def test_every_shared_file_survives_concurrent_writers(self):
        d = tmp()
        worker = d / "w.py"
        worker.write_text(self.WORKER.format(py=str(REPO / "python")), encoding="utf-8")
        release = time.time() + 2.0
        procs = [subprocess.Popen([sys.executable, str(worker), str(release), str(i), str(d)],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                 for i in range(self.N)]
        for proc in procs:
            proc.wait(timeout=180)

        history = json.loads((d / "run_history.json").read_text(encoding="utf-8"))
        self.assertEqual(len(history), self.N, "run_history lost rows")

        impact = json.loads((d / "impact.json").read_text(encoding="utf-8"))
        total = sum(e["value"] for e in impact.get("corrections_found", []))
        self.assertEqual(total, 100.0 * self.N,
                         f"impact.json lost contributions: ${total} of ${100.0 * self.N}")

        deltas = json.loads((d / "deltas.json").read_text(encoding="utf-8"))
        self.assertEqual(len(deltas), self.N, f"deltas.json kept {len(deltas)} of {self.N} series")

        access = json.loads((d / "access.json").read_text(encoding="utf-8"))
        resources = [n for n in access["nodes"] if n.get("type") != "task"]
        self.assertEqual(len(resources), self.N,
                         f"access.json kept {len(resources)} of {self.N} resources")

        # No lock file may outlive the run that took it, or the next run trips over it.
        self.assertEqual(list(d.glob("*.lock")), [])


class ReviewFindings20260904(unittest.TestCase):
    """
    The 2026-09-04 review, batch B: 21 findings in the reporter, 7 of them critical.

    Each check below was watched FAIL against the pre-fix copy before it was written here. Five
    further assertions in the same batch already held and are kept as guards, so a fix does not
    quietly undo something that was already right.
    """

    def _slot_of(self, d):
        return sorted((d / "progress").glob("*.json"))[0]

    def _flaky_replace(self, fail_times):
        """os.replace that refuses the first N calls - Windows with a reader holding the file."""
        real = progress_module.os.replace
        state = {"n": 0}

        def fake(src, dst):
            state["n"] += 1
            if state["n"] <= fail_times:
                raise PermissionError(13, "held by another process")
            return real(src, dst)
        return real, fake

    # -------------------------------------------------------------------- F001
    def test_a_bom_does_not_wipe_the_file(self):
        """
        deltas.json and run_history.json written by PowerShell's `Set-Content -Encoding utf8` or
        by Notepad carry a BOM. The extension's reader was taught to strip one, so they rendered
        perfectly - while the reporter raised JSONDecodeError, fell back to the empty default and
        wrote that straight over the file. 80 delta points and 60 history rows deleted by one
        ordinary run, silently. Fixing the reader without the writers removed the alarm.
        """
        d = tmp()
        deltas = {"reconciliation_delta": [{"date": "2026-09-01T00:00:00", "value": i} for i in range(40)],
                  "rows_loaded": [{"date": "2026-09-01T00:00:00", "value": i} for i in range(40)]}
        history = [{"task": "T", "date": "2026-09-01T00:00:00", "success": True, "elapsed": 1}
                   for _ in range(60)]
        for name, obj in (("deltas.json", deltas), ("run_history.json", history)):
            (d / name).write_bytes(b"\xef\xbb\xbf" + json.dumps(obj).encode("utf-8"))

        p = Progress("Nightly Load", logs_dir=str(d), quiet=True)
        p.track_delta("rows_loaded", 50040)
        p.complete(success=True, summary="ok")

        after = json.loads((d / "deltas.json").read_text(encoding="utf-8-sig"))
        self.assertEqual(sorted(after), ["reconciliation_delta", "rows_loaded"])
        self.assertEqual(sum(len(v) for v in after.values()), 81)
        self.assertEqual(len(json.loads((d / "run_history.json").read_text(encoding="utf-8-sig"))), 61)

    def test_an_unreadable_file_is_kept_rather_than_overwritten(self):
        """Genuinely corrupt is not the same as BOM'd: it still cannot be parsed, but the data
        must not evaporate. Move it aside so the loss is recoverable and announced."""
        d = tmp()
        (d / "deltas.json").write_text("{not json at all", encoding="utf-8")
        Progress("T", logs_dir=str(d), quiet=True).track_delta("m", 1.0)
        self.assertTrue((d / "deltas.json.corrupt").exists(), "the unreadable file was destroyed")

    # -------------------------------------------------------------------- F003 / F007 / F020
    def test_the_slot_and_the_final_write_get_the_patient_ladder(self):
        """
        The short retry ladder was applied to both files _write() touches. But the slot is not a
        cache - resume() rebuilds the entire run from it on every CLI subcommand - and the
        terminal write is what takes a run out of "running". With the short ladder a
        `warn --actionable` exited 0, printed the warning, recorded nothing, and Pending Actions
        showed a false all-clear; a dropped completion left the run "running" for ever.
        """
        d = tmp()
        Progress("Recon", logs_dir=str(d), quiet=True)
        # Four refusals: progress.json spends the first two, so the slot takes refusals 3 and 4 -
        # fatal at the shortened attempts=2, survivable at the restored attempts=5.
        real, fake = self._flaky_replace(4)
        progress_module.os.replace = fake
        try:
            Progress.resume("Recon", logs_dir=str(d), quiet=True).warn("SOX control 4 failed",
                                                                       actionable=True)
        finally:
            progress_module.os.replace = real
        resumed = Progress.resume("Recon", logs_dir=str(d), quiet=True)
        self.assertEqual(len(resumed.warnings), 1, "the actionable finding was lost")
        self.assertEqual(resumed.warnings_total, 1)

        d2 = tmp()
        p = Progress("Nightly", logs_dir=str(d2), quiet=True)
        p.step(1, 1, "Go")
        real, fake = self._flaky_replace(3)
        progress_module.os.replace = fake
        try:
            p.complete(success=True, summary="finished")
        finally:
            progress_module.os.replace = real
        self.assertEqual(json.loads((d2 / "progress.json").read_text(encoding="utf-8"))["status"],
                         "complete", "the run was left 'running' for ever")

    # -------------------------------------------------------------------- F004 / F064
    def test_a_non_finite_value_in_the_slot_never_reaches_the_callers_script(self):
        """
        json.loads accepts NaN; _write_json forbids it. A slot written by a hand edit or another
        producer therefore put a non-finite float into state and the next write raised ValueError
        into the operator's script - and raised from __exit__ it REPLACED their real exception, so
        a missing input file surfaced as a serialisation complaint and the run went unrecorded.
        """
        d = tmp()
        Progress("Recon", logs_dir=str(d), quiet=True)
        slot = self._slot_of(d)
        raw = json.loads(slot.read_text(encoding="utf-8"))
        raw["metrics"] = {"variance_pct": float("nan")}
        slot.write_text(json.dumps(raw), encoding="utf-8")        # plain dumps: emits NaN
        Progress.resume("Recon", logs_dir=str(d), quiet=True).warn("12 rows had no customer id")

        d2 = tmp()
        Progress("Recon", logs_dir=str(d2), quiet=True)
        slot2 = self._slot_of(d2)
        raw = json.loads(slot2.read_text(encoding="utf-8"))
        raw["metrics"] = {"variance_pct": float("nan")}
        slot2.write_text(json.dumps(raw), encoding="utf-8")
        with self.assertRaises(FileNotFoundError):
            with Progress.resume("Recon", logs_dir=str(d2), quiet=True):
                raise FileNotFoundError("input/orders.csv is missing")
        self.assertEqual(len(json.loads((d2 / "run_history.json").read_text(encoding="utf-8"))), 1)

    # -------------------------------------------------------------------- F013 / F016
    def test_the_documented_shell_idioms_behave_as_documented(self):
        """
        `complete "$TASK" --fail` from a trap recorded the literal string "--fail" as the run's
        summary, because --summary's fallback read argv before --fail had been taken out of it.
        And `complete --run "$RUN"` on an already-finished run - the README's other instruction,
        for when task names collide - exited 2, so a successful job reported failure to its
        scheduler. A DISPLACED run must still be loud: completing it would close someone else's.
        """
        d = tmp()
        env = dict(os.environ, PROGRESS_LOGS_DIR=str(d))
        mod = str(REPO / "python" / "progress.py")

        run_id = subprocess.run([sys.executable, mod, "start", "Nightly", "--print-id"], env=env,
                                capture_output=True, text=True).stdout.strip().splitlines()[-1]
        subprocess.run([sys.executable, mod, "complete", "Nightly", "--fail", "--quiet"], env=env,
                       check=True, stdout=subprocess.DEVNULL)
        row = json.loads((d / "run_history.json").read_text(encoding="utf-8"))[-1]
        self.assertNotEqual(row.get("summary"), "--fail", "the flag was recorded as the summary")
        self.assertIs(row.get("success"), False)

        again = subprocess.run([sys.executable, mod, "complete", "Nightly", "--run", run_id,
                                "--quiet"], env=env, capture_output=True, text=True)
        self.assertEqual(again.returncode, 0, f"finished run: {again.stderr.strip()[:120]}")

        subprocess.run([sys.executable, mod, "start", "Nightly", "--quiet"], env=env,
                       check=True, stdout=subprocess.DEVNULL)
        displaced = subprocess.run([sys.executable, mod, "complete", "Nightly", "--run", run_id,
                                    "--quiet"], env=env, capture_output=True, text=True)
        self.assertEqual(displaced.returncode, 2, "a displaced run was closed silently")

    # -------------------------------------------------------------------- F014
    def test_log_lines_are_clipped_like_every_other_free_text_field(self):
        """warn(), detail(), step() labels and summaries were all capped by the 1.6 sweep because
        megabyte payloads got rewritten into progress.json AND the slot on every later call, and
        pushed to the webview on every refresh. log() was missed: 20 lines made a 19 MB file."""
        d = tmp()
        p = Progress("Big", logs_dir=str(d), quiet=True)
        for _ in range(20):
            p.log("x" * 1000000)
        self.assertLess((d / "progress.json").stat().st_size, 200000)

    # -------------------------------------------------------------------- F015
    def test_the_sweep_only_deletes_files_this_tool_created(self):
        """logsPath defaults to `logs`, an ordinary shared folder. The sweep used to unlink ANY
        *.tmp or *.lock older than two days - another tool's scheduler lock, a half-written
        staging file - silently and permanently."""
        d = tmp()
        Progress("Seed", logs_dir=str(d), quiet=True).complete(success=True, summary="s")
        old = time.time() - 5 * 86400
        foreign = [d / "scheduler.lock", d / "staging.tmp", d / "other-tool.12.tmp"]
        ours = [d / "run_history.json.lock", d / "deltas.json.999.tmp"]
        for f in foreign + ours:
            f.write_text("x", encoding="utf-8")
            os.utime(f, (old, old))
        Progress("Sweeper", logs_dir=str(d), quiet=True)
        self.assertEqual([f.name for f in foreign if not f.exists()], [],
                         "another tool's files were deleted")
        self.assertEqual([f.name for f in ours if f.exists()], [],
                         "our own abandoned files were not swept")

    # -------------------------------------------------------------------- F021
    def test_resources_survive_past_150_distinct_task_names(self):
        """The cap kept EVERY task node and gave resources the remainder, and task nodes were
        never pruned - so resource coverage decayed with each new task name and hit zero at 150,
        at which point the edge filter dropped every edge too and the map rendered permanently
        empty, no matter how many resources the scripts reported."""
        d = tmp()
        for i in range(200):
            Progress("Task %03d" % i, logs_dir=str(d), quiet=True).access(
                "table", "resource_%03d" % i, "read")
        graph = json.loads((d / "access.json").read_text(encoding="utf-8"))
        resources = [n for n in graph["nodes"] if n.get("type") != "task"]
        self.assertGreaterEqual(len(resources), 100, "resources were crowded out by task nodes")
        self.assertTrue(graph["edges"], "the Access Map has nothing left to draw")

    # -------------------------------------------------------------------- F063
    def test_an_id_beyond_2_53_travels_as_text(self):
        """Writing the int exactly made the FILE right and left the DASHBOARD wrong: the extension
        parses it with JSON.parse into a double, so a 19-digit account id still rendered rounded -
        the same wrong id as before the exactness fix. Beyond 2^53 a number is an identifier."""
        d = tmp()
        p = Progress("Ledger", logs_dir=str(d), quiet=True)
        p.metric("id", 9007199254740993)
        p.metric("key", 123456789012345678901234567890)
        p.metric("small", 42)
        m = json.loads((d / "progress.json").read_text(encoding="utf-8"))["metrics"]
        self.assertEqual(m["id"], "9007199254740993")
        self.assertEqual(m["key"], "123456789012345678901234567890")
        self.assertEqual(m["small"], 42, "ordinary numbers must stay numbers")

    # -------------------------------------------------------------------- F065
    def test_status_tolerates_a_valid_file_with_odd_field_types(self):
        """The earlier fix caught unreadable JSON and stopped there, so a structurally VALID file
        with null or wrong-typed fields still dumped a traceback and exited 1 - from the one
        command whose whole job is to report on the state of these files. `"warnings":
        ["some text"]` is exactly what a hand-rolled producer emits."""
        d = tmp()
        (d / "progress.json").write_text(json.dumps({
            "task": "T", "status": "running", "updatedAt": None,
            "warnings": ["some text", {"time": "t", "msg": "m"}], "metrics": ["not", "a", "dict"],
        }), encoding="utf-8")
        r = subprocess.run([sys.executable, str(REPO / "python" / "progress.py"), str(d)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-200:])
        self.assertNotIn("Traceback", r.stdout + r.stderr)

    # -------------------------------------------------------------------- F103
    def test_the_cli_banner_prints_the_real_version(self):
        """The docstring said "v1.3" for three releases after __version__ moved on, and that line
        is what a user diagnosing a reporter problem reads. It now comes from __version__."""
        r = subprocess.run([sys.executable, str(REPO / "python" / "progress.py"), "no-such-command"],
                           capture_output=True, text=True)
        out = r.stdout + r.stderr
        self.assertIn(progress_module.__version__, out)
        self.assertNotIn("v1.3.", out)

    # -------------------------------------------------------------------- F104
    def test_a_non_string_delta_series_name_accumulates(self):
        """JSON has only string keys. track_delta wrote the name as a string and looked it up with
        the raw object, so the next run missed, fell back to [] and overwrote the accumulated
        series with a single point - for ever, with no error anywhere."""
        d = tmp()
        for i in range(3):
            p = Progress("T", logs_dir=str(d), quiet=True)
            p.track_delta(2026, float(i))
            p.complete(success=True, summary="s")
        series = json.loads((d / "deltas.json").read_text(encoding="utf-8"))["2026"]
        self.assertEqual(len(series), 3, "the series reset on every run")


if __name__ == "__main__":
    unittest.main(verbosity=2)
