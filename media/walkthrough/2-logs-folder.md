## One folder, four files

Your scripts write into a single folder; the extension watches it. Set the folder with
`scriptProgress.logsPath`. A relative path resolves against the **first** workspace folder;
an absolute path is used as-is.

```json
{
  "scriptProgress.logsPath": "logs",
  "scriptProgress.refreshInterval": 2000,
  "scriptProgress.staleRunningMinutes": 30
}
```

- `scriptProgress.logsPath` — the folder holding `progress.json`, `run_history.json`,
  `deltas.json` and `access.json` (plus a `progress/` subfolder, one file per task).
- `scriptProgress.refreshInterval` — fallback poll in milliseconds. File changes are picked up
  immediately by a watcher; this only catches what the watcher misses.
- `scriptProgress.staleRunningMinutes` — how long a task may say *running* without an update
  before it is shown as **STALLED**. That is what a script dying without reporting looks like.

[Open Settings](command:scriptProgress.openSettings) ·
[Open Logs Folder](command:scriptProgress.openLogsFolder) ·
[Refresh](command:scriptProgress.refresh)

**Open Logs Folder** offers to create the folder if it is not there yet. Writes from the
reporter are atomic (temp file, then rename), so the extension never reads a half-written
file — and if it ever does see bad JSON, it keeps the last good copy and says so at the top
of the dashboard.
