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


if __name__ == "__main__":
    unittest.main(verbosity=2)
