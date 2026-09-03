# -*- coding: utf-8 -*-
"""
Demo script: pretends to be a 7-step data job so you can watch the dashboard react.

    python demo/fake_run.py            # ~40 s run with warnings, a delta and access calls
    python demo/fake_run.py --fast     # same story in ~6 s
    python demo/fake_run.py --fail     # ends in a failure
    python demo/fake_run.py --crash    # raises mid-run (the 'with' block reports FAILED)
    python demo/fake_run.py --stall    # exits mid-run WITHOUT reporting -> shows as STALLED later
    python demo/fake_run.py --task "Weekly Rollup" --steps 4

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--fail", action="store_true")
    ap.add_argument("--crash", action="store_true")
    ap.add_argument("--stall", action="store_true")
    ap.add_argument("--task", default="Demo Pipeline")
    ap.add_argument("--steps", type=int, default=len(STEPS))
    args = ap.parse_args()

    pause = 0.8 if args.fast else 5.5
    steps = STEPS[: max(1, min(len(STEPS), args.steps))]
    rng = random.Random()

    with Progress(args.task, logs_dir=HERE / "logs") as p:
        for i, (label, kind, name, mode) in enumerate(steps, start=1):
            p.step(i, len(steps), label)
            if kind:
                p.access(kind, name, mode=mode)
            time.sleep(pause / 2)
            p.detail(f"{rng.randint(1000, 5000):,} rows")
            if i == 3:
                p.warn(f"{rng.randint(3, 40)} rows had no customer id")
            if i == 5:
                p.warn("Totals differ from prior month by more than 20%")
            if i == 4 and args.stall:
                # A hard exit skips the 'with' block's cleanup, exactly like a killed process,
                # so progress.json stays at 'running' and the dashboard should flip to STALLED.
                print("\n(simulating a killed process with no report - the dashboard should show STALLED)")
                sys.stdout.flush()
                os._exit(0)
            if i == 4 and args.crash:
                raise RuntimeError("simulated crash inside the with-block")
            time.sleep(pause / 2)

        p.track_delta("rows_loaded", rng.randint(3800, 4200))
        p.track_delta("reconciliation_delta", round(rng.uniform(-0.5, 0.5), 2))

        if args.fail:
            p.complete(success=False, summary="Row count mismatch: expected 4,013 got 3,977")
        else:
            p.complete(success=True, summary=f"INSERT: {rng.randint(3800, 4200):,} rows | total ${rng.uniform(10, 20):.1f}M")


if __name__ == "__main__":
    main()
