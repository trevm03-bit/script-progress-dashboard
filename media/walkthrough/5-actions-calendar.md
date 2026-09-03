## Buttons that run things, and a calendar that nags

**Quick Actions** are buttons you define; **Process Calendar** lists the jobs that are meant
to run and tells you which have not. Both are plain settings.

```json
{
  "scriptProgress.sections.quickActions": true,
  "scriptProgress.quickActions.buttons": [
    { "label": "Nightly Load", "command": "python scripts/nightly_load.py",
      "icon": "play", "group": "Daily", "task": "Nightly Load" },
    { "label": "Month-End Close",
      "command": "python scripts/month_end.py --month ${prompt:Month (YYMM)}",
      "icon": "calendar", "group": "Monthly", "confirm": true, "cwd": "scripts" }
  ],
  "scriptProgress.quickActions.runVia": "terminal",

  "scriptProgress.sections.processCalendar": true,
  "scriptProgress.processCalendar.processes": [
    { "name": "Nightly Load", "label": "Nightly Load", "frequency": "daily", "dueHour": 9 },
    { "name": "Weekly Rollup", "label": "Weekly Rollup", "frequency": "weekly", "dayOfWeek": 5 },
    { "name": "Month-End Close", "label": "Month-End Close", "frequency": "monthly", "dayOfMonth": 5 }
  ],
  "scriptProgress.processCalendar.view": "both"
}
```

- `${prompt:Month (YYMM)}` anywhere in a `command` asks for that value before running, and
  `${file}` becomes the active editor's file. `confirm` defaults to `true` and shows the final
  command first.
- `scriptProgress.quickActions.runVia` — `terminal` sends the command to one reusable
  *Script Progress* terminal; `task` runs it as a VS Code task, so it appears under
  Terminal → Run Task and its exit code is captured.
- A process `name` matches the **start** of a task name, case-insensitively, so `Nightly Load`
  covers `Nightly Load Phase 2`. `dueHour` is the local hour a daily job is overdue after,
  `dayOfWeek` is the ISO weekday a weekly job is due by (1 = Monday … 7 = Sunday), and
  `dayOfMonth` is the day a monthly job is due by.

[Open Dashboard](command:scriptProgress.openPanel) ·
[Run Quick Action](command:scriptProgress.runQuickAction) ·
[Open Settings](command:scriptProgress.openSettings)
