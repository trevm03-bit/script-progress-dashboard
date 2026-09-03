## Every section is a switch

Thirteen sections, each with its own `scriptProgress.sections.*` key. Six are on by default
(summary, activeTask, warnings, lastCompleted, runHistory, timeline); the heavier seven
(processCalendar, quickActions, deltaTracker, metrics, warningTrends, scriptHealth, accessMap)
start off, so you turn on only what you use.

[Choose Dashboard Sections](command:scriptProgress.toggleSections) is the fast way — it ticks
the same settings.

```json
{
  "scriptProgress.sections.processCalendar": true,
  "scriptProgress.sections.quickActions": true,
  "scriptProgress.sections.scriptHealth": true,
  "scriptProgress.dashboard.sectionOrder": [
    "summary", "activeTask", "warnings", "quickActions",
    "processCalendar", "timeline", "runHistory", "lastCompleted",
    "deltaTracker", "metrics", "warningTrends", "scriptHealth", "accessMap"
  ],
  "scriptProgress.dashboard.sidebarSections": ["summary", "activeTask", "warnings"],
  "scriptProgress.dashboard.collapsible": true,
  "scriptProgress.dashboard.density": "compact"
}
```

- `scriptProgress.dashboard.sectionOrder` — top-to-bottom order. Anything you leave out goes
  last, so you can list just the two you want first.
- `scriptProgress.dashboard.sidebarSections` — what the narrow sidebar shows. Empty means the
  same as the tab; the example above keeps the sidebar to the live essentials and leaves the
  full set for [Open Dashboard](command:scriptProgress.openPanel).
- `scriptProgress.dashboard.collapsible` — click a section title to fold it; the choice sticks.
- `scriptProgress.dashboard.density` — `comfortable` or `compact`.

[Open Settings](command:scriptProgress.openSettings)
