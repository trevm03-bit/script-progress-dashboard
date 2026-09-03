# -*- coding: utf-8 -*-
"""
Demo script: pretends to be a 7-step data job so you can watch the dashboard react.

    python fake_run.py            # ~40 s run with warnings, metrics, a log tail and access calls
    python fake_run.py --fast     # same story in ~7 s
    python fake_run.py --fail     # ends in a failure
    python fake_run.py --crash    # raises mid-run (the 'with' block reports FAILED)
    python fake_run.py --stall    # exits mid-run WITHOUT reporting -> shows as STALLED later
    python fake_run.py --task "Weekly Rollup" --steps 4
    python fake_run.py --parallel # a second task alongside (run in another terminal)

Writes into demo/logs/ (the demo workspace's scriptProgress.logsPath).
"""
import argparse
import os
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "python"))
from progress import Progress  # noqa: E402

STEPS = [
    ("Reading input file", "file", "input/orders.csv", "read"),
    ("Validating rows", None, None, None),
    ("Looking up customers", "table", "crm.customers", "read"),
    ("Joining products", "table", "catalog.products", "read"),
    ("Calculating totals", None, None, None),
    ("Writing warehouse table", "table", "sales.orders_monthly", "write"),
    ("Posting summary", "api", "Reporting service", "write"),
]

PARALLEL_STEPS = [
    ("Pulling yesterday's totals", "table", "sales.orders_monthly", "read"),
    ("Refreshing the rollup", "table", "reports.weekly_rollup", "write"),
    ("Emailing the summary", "api", "Mail relay", "write"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--fail", action="store_true")
    ap.add_argument("--crash", action="store_true")
    ap.add_argument("--stall", action="store_true")
    ap.add_argument("--kill", action="store_true", help="die mid-run with exit code 3 (no report) - shows as EXITED when run as a task")
    ap.add_argument("--parallel", action="store_true", help="run the short 'Weekly Rollup' job instead")
    ap.add_argument("--task", default=None)
    ap.add_argument("--steps", type=int, default=None)
    args = ap.parse_args()

    pause = 0.9 if args.fast else 5.5
    steps = PARALLEL_STEPS if args.parallel else STEPS
    task = args.task or ("Weekly Rollup" if args.parallel else "Demo Pipeline")
    if args.steps:
        steps = steps[: max(1, min(len(steps), args.steps))]
    rng = random.Random()

    with Progress(task, logs_dir=HERE / "logs") as p:
        p.log("started with " + " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "started with no options")
        total_rows = 0
        for i, (label, kind, name, mode) in enumerate(steps, start=1):
            p.step(i, len(steps), label)
            if kind:
                p.access(kind, name, mode=mode)
            # Progress within the step, so the bar moves smoothly.
            chunks = 5
            for c in range(1, chunks + 1):
                time.sleep(pause / chunks)
                p.substep(c / chunks)
            rows = rng.randint(1000, 5000)
            total_rows += rows
            p.detail(f"{rows:,} rows")
            p.log(f"{label.lower()} done in {pause:.1f}s")
            if i == 3:
                p.warn(f"{rng.randint(3, 40)} rows had no customer id")
            if i == 5:
                p.warn("Totals differ from prior month by more than 20%")
                p.metric("rows_loaded", rng.randint(3800, 4200))
            if i == 3 and args.kill:
                print("\n(simulating a hard crash: exit code 3 with no report)")
                sys.stdout.flush()
                os._exit(3)
            if i == 4 and args.stall:
                # A hard exit skips the 'with' block's cleanup, exactly like a killed process,
                # so progress.json stays at 'running' and the dashboard should flip to STALLED.
                print("\n(simulating a killed process with no report - the dashboard should show STALLED)")
                sys.stdout.flush()
                os._exit(0)
            if i == 4 and args.crash:
                raise RuntimeError("simulated crash inside the with-block")

        p.metric("rows_seen", total_rows)
        p.metric("total_value", f"${rng.uniform(10, 20):.1f}M")
        p.artifact(str(HERE / "logs" / "run_history.json"))
        p.track_delta("rows_loaded", rng.randint(3800, 4200))
        p.track_delta("reconciliation_delta", round(rng.uniform(-0.5, 0.5), 2))

        if args.fail:
            p.complete(success=False, summary="Row count mismatch: expected 4,013 got 3,977")
        else:
            p.complete(success=True, summary=f"INSERT: {total_rows:,} rows | total {p.metrics['total_value']}")


if __name__ == "__main__":
    main()
