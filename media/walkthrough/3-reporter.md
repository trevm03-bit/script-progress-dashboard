## Five lines in your script

Copy `python/progress.py` out of this extension into your project — `scripts/lib/progress.py`
is a good home — and wrap the job. It needs nothing outside the Python standard library
(3.10+). A Node version is in `reporters/progress.js` with the same methods in camelCase.

```python
from lib.progress import Progress

with Progress("Nightly Load") as p:          # a crash in here is reported as FAILED
    p.step(1, 3, "Reading input file")
    p.access("file", "input/orders.csv")     # feeds the Access Map
    p.detail("Rows: 3,990")

    p.step(2, 3, "Loading warehouse table")
    p.access("table", "sales.orders", mode="write")
    p.warn("12 rows had no customer id")
    p.metric("rows_loaded", 3990)

    p.step(3, 3, "Reconciling")
    p.track_delta("reconciliation_delta", 0.0)
    p.complete(success=True, summary="INSERT: 3,990 rows")
```

Type `progress` in a Python file for that whole block as a snippet; `progress-step`,
`progress-access` and `progress-wrap` are there too. Every call also prints, so the terminal
tells the same story as the dashboard.

**Where it writes.** The reporter picks its logs folder in this order: the `logs_dir`
argument, the `PROGRESS_LOGS_DIR` environment variable, the nearest parent folder of
`progress.py` containing `logs/` or `.git/` (so `scripts/lib/progress.py` writes to
`<project>/logs/`), then `./logs`. Point `scriptProgress.logsPath` at the same folder.

Run `python progress.py` on its own to print the current status in a terminal.

[Open Settings](command:scriptProgress.openSettings) ·
[Show Run History (text)](command:scriptProgress.showHistory)
