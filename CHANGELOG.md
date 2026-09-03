# Changelog

## 1.0.0 — 2026-09-02

First release. Every section ships and is switchable:

- Status bar item with running / stalled / complete / failed states and a live elapsed timer
- Sidebar view and editor-tab dashboard from one renderer; updates are patched in, never reloaded
- Active Task, Warnings, Last Completed, Run History (sortable), Process Calendar,
  Quick Actions (`${prompt:…}` inputs, confirmation, workspace-trust gate), Delta Tracker,
  Script Health, Access Map (Canvas 2D constellation)
- Python reporter with atomic writes, crash reporting via `with`, `access()` and `track_delta()`
- Unit tests for every pure module (`node --test`) and the Python reporter (`unittest`)
