## Every section is a switch

Fifteen sections, each with its own `scriptProgress.sections.*` key. Nine are on by default
(summary, activeTask, warnings, lastCompleted, runHistory, processCalendar, timeline,
scriptHealth, pendingActions) — the ones that are useful with no configuration at all. The other
six (quickActions, deltaTracker, metrics, warningTrends, impact, accessMap) start off because each
one needs you to tell it something first, so you turn on only what you use.

[Choose Dashboard Sections](command:scriptProgress.toggleSections) is the fast way — it ticks
the same settings.

```json
{
  "scriptProgress.sections.quickActions": true,
  "scriptProgress.sections.deltaTracker": true,
  "scriptProgress.sections.impact": true,
  "scriptProgress.dashboard.sectionOrder": [
    "summary", "activeTask", "warnings", "pendingActions", "quickActions",
    "processCalendar", "timeline", "runHistory", "lastCompleted",
    "deltaTracker", "metrics", "impact", "warningTrends", "scriptHealth", "accessMap"
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
