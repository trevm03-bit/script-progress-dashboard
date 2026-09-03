## See it working first

**Script Progress: Simulate a Demo Run** writes exactly the same JSON files a real script
writes — one step at a time, with a warning, a couple of metrics and a summary — into the
folder the extension is already watching. Nothing is faked in the UI: what you see is the
extension reading files off disk.

Run it, then watch three places at once:

- the **status bar**, bottom left: `3/7 Reconciling · 2m10s`
- the **Script Progress** icon in the Activity Bar, which shows a badge while a task runs
- the **Dashboard** view inside it, where the Active Task card fills in

[Simulate a Demo Run](command:scriptProgress.simulateRun) ·
[Show Sidebar](command:scriptProgress.focusSidebar) ·
[Open Dashboard](command:scriptProgress.openPanel)

When the run finishes it drops into **Run History** and **Last Completed**, and the status
bar switches to the last result.

### If nothing appears

The demo run needs somewhere to write. It uses `scriptProgress.logsPath` like everything
else, so if that folder does not exist yet, use
[Open Logs Folder](command:scriptProgress.openLogsFolder) — it offers to create it — and run
the simulation again. The next step covers pointing the extension at the folder you actually
want.
