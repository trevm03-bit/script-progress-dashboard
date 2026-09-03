"""Seed two weeks of realistic demo history so every dashboard section has something to show.

    python demo/seed_demo.py            # writes into demo/logs (or $SCRIPT_PROGRESS_DIR)
    python demo/seed_demo.py --clean    # remove the seeded files first

It writes run_history.json, deltas.json and access.json only. progress.json (the live task
state) is left alone, so run demo/fake_run.py afterwards to watch a run on top of the history.
Stdlib only; deterministic (same numbers every time) so screenshots are reproducible.
"""
from __future__ import annotations

import json
import os
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOGS = Path(os.environ.get("SCRIPT_PROGRESS_DIR") or HERE / "logs")

TASKS = {
    # name: (typical seconds, daily?, resources touched)
    "Demo Pipeline": (38, True, [("file", "input/orders.csv", "read"), ("table", "crm.customers", "read"), ("table", "catalog.products", "read"), ("table", "sales.orders_monthly", "write"), ("api", "Reporting service", "write")]),
    "Nightly Refresh": (610, True, [("table", "sales.orders_monthly", "read"), ("table", "warehouse.fact_sales", "write"), ("table", "warehouse.dim_customer", "write"), ("api", "BI service", "write")]),
    "Weekly Rollup": (95, False, [("table", "warehouse.fact_sales", "read"), ("file", "reports/weekly_rollup.xlsx", "write"), ("api", "Mail relay", "write")]),
    "Data Quality Checks": (52, True, [("table", "warehouse.fact_sales", "read"), ("table", "crm.customers", "read"), ("file", "reports/dq_report.html", "write")]),
}
WARNINGS = [
    "{n} rows had no customer id",
    "Totals differ from prior month by more than 20%",
    "Duplicate order id {n} skipped",
    "Retrying API call ({n}/3)",
    "{n} products missing a category",
]


def iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%S")


def main() -> int:
    rnd = random.Random(20260903)
    LOGS.mkdir(parents=True, exist_ok=True)
    if "--clean" in sys.argv:
        for f in ("run_history.json", "deltas.json", "access.json"):
            try:
                (LOGS / f).unlink()
            except FileNotFoundError:
                pass
        print(f"removed seeded files from {LOGS}")
        return 0

    end = datetime.now().replace(second=0, microsecond=0)
    history: list[dict] = []
    deltas: dict[str, list[dict]] = {"rows_loaded": [], "reconciliation_delta": [], "dq_failures": []}
    nodes: dict[str, dict] = {}
    edges: dict[tuple[str, str], dict] = {}

    for day_back in range(14, -1, -1):
        day = (end - timedelta(days=day_back)).replace(hour=0, minute=0)
        for name, (typical, daily, resources) in TASKS.items():
            if not daily and day.weekday() != 0:
                continue  # weekly job runs on Mondays
            if day_back == 0 and name == "Nightly Refresh":
                continue  # tonight has not happened yet
            hour = {"Demo Pipeline": 9, "Nightly Refresh": 2, "Weekly Rollup": 7, "Data Quality Checks": 10}[name]
            started = day.replace(hour=hour, minute=rnd.randint(0, 40))
            if day_back == 0 and started > end:
                continue
            elapsed = typical * rnd.uniform(0.85, 1.2)
            success = True
            note = ""
            if name == "Nightly Refresh" and day_back == 3:
                elapsed = typical * 2.7  # the slow night
                note = "slow"
            if name == "Demo Pipeline" and day_back == 6:
                success = False
            if name == "Data Quality Checks" and day_back in (8, 1):
                success = False
            ended = started + timedelta(seconds=elapsed)
            n_warn = 0 if rnd.random() < 0.45 else rnd.randint(1, 3)
            if day_back <= 2 and name == "Demo Pipeline":
                n_warn += 2  # rising warnings this week
            items = []
            for i in range(n_warn):
                t = started + timedelta(seconds=elapsed * (i + 1) / (n_warn + 1))
                items.append({"time": iso(t), "msg": rnd.choice(WARNINGS).format(n=rnd.randint(3, 40))})
            rows = int(rnd.gauss(4000, 180)) if name != "Nightly Refresh" else int(rnd.gauss(180000, 4000))
            recon = round(rnd.gauss(0, 0.4), 2)
            dq = rnd.randint(0, 4) + (6 if not success and name == "Data Quality Checks" else 0)
            metrics = {"rows_loaded": rows, "total_value": f"${rnd.uniform(15, 19):.1f}M"} if name in ("Demo Pipeline", "Nightly Refresh") else {}
            if name == "Data Quality Checks":
                metrics = {"checks_run": 42, "checks_failed": dq}
            if name == "Weekly Rollup":
                metrics = {"sheets": 6, "rows_loaded": rows}
            summary = (
                f"INSERT: {rows:,} rows" if success and name != "Data Quality Checks"
                else f"{42 - dq}/42 checks passed" if name == "Data Quality Checks"
                else "ERROR: connection reset by the warehouse"
            )
            run_id = started.strftime("%Y%m%d-%H%M%S") + f"-{rnd.randrange(16**6):06x}"
            accessed = [f"{k}:{n}" for k, n, _ in resources]
            history.append({
                "task": name, "date": iso(ended), "success": success, "elapsed": round(elapsed, 1), "summary": summary,
                "warnings": len(items), "runId": run_id, "startedAt": iso(started), "metrics": metrics,
                "warningItems": items, "accessed": accessed,
                **({"artifacts": [str(LOGS / "reports" / "weekly_rollup.xlsx")]} if name == "Weekly Rollup" else {}),
            })
            if "rows_loaded" in metrics:
                deltas["rows_loaded"].append({"date": iso(ended), "value": rows, "task": name})
            if name == "Demo Pipeline":
                deltas["reconciliation_delta"].append({"date": iso(ended), "value": recon, "task": name})
            if name == "Data Quality Checks":
                deltas["dq_failures"].append({"date": iso(ended), "value": dq, "task": name})
            task_id = f"task:{name}"
            nodes[task_id] = {"id": task_id, "type": "task", "label": name, "lastSeen": iso(ended)}
            for kind, res, mode in resources:
                rid = f"{kind}:{res}"
                nodes[rid] = {"id": rid, "type": kind, "label": res, "lastSeen": iso(ended)}
                e = edges.setdefault((task_id, rid), {"from": task_id, "to": rid, "mode": mode, "count": 0, "lastSeen": iso(ended)})
                e["count"] += 1
                e["lastSeen"] = iso(ended)

    history.sort(key=lambda r: r["date"])
    (LOGS / "run_history.json").write_text(json.dumps(history, indent=1), encoding="utf-8")
    (LOGS / "deltas.json").write_text(json.dumps(deltas, indent=1), encoding="utf-8")
    (LOGS / "access.json").write_text(json.dumps({"nodes": list(nodes.values()), "edges": list(edges.values())}, indent=1), encoding="utf-8")
    print(f"seeded {len(history)} runs over 15 days into {LOGS} ({len(nodes)} graph nodes, {len(edges)} edges)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
