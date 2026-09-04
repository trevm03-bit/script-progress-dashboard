// Every command the extension registers, in one place. Thin: the logic lives in logic/ and the
// state comes from the StateProvider so commands never hold data of their own.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActionRunner, commandForFile } from './actions';
import { DashboardPanel } from './dashboardPanel';
import { FILES } from './dataReader';
import { dailySummaryText, historyCsv, weeklyDigestText } from './logic/summary';
import { compareRuns, defaultBaseline, runKey } from './logic/compare';
import { comparisonText } from './logic/compareText';
import { DeltaPoint, RunRecord } from './types';
import { dateTime, formatDuration, parseIso, taskState } from './logic/time';
import { simulateRun } from './simulate';
import { reportHtml } from './logic/report';
import { ALL_SECTIONS, SECTION_TITLES, SectionId } from './types';

import { StateProvider } from './dashboardHost';

export interface CommandContext extends StateProvider {
  extensionUri: vscode.Uri;
  logsDir(): string;
  refresh(force?: boolean): void;
  runner: ActionRunner;
}

let historyChannel: vscode.OutputChannel | undefined;

export function registerCommands(context: vscode.ExtensionContext, cx: CommandContext): void {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('scriptProgress.openPanel', () => DashboardPanel.createOrShow(cx.extensionUri, cx, 'panel'));
  reg('scriptProgress.openMap', () => DashboardPanel.createOrShow(cx.extensionUri, cx, 'map'));
  reg('scriptProgress.focusSidebar', () => vscode.commands.executeCommand('scriptProgress.dashboard.focus'));
  reg('scriptProgress.refresh', () => cx.refresh(true));
  reg('scriptProgress.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:trevor-marshall.script-progress-dashboard'));
  reg('scriptProgress.openWalkthrough', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', 'trevor-marshall.script-progress-dashboard#scriptProgress.gettingStarted', false));

  reg('scriptProgress.openLogsFolder', async () => {
    const dir = cx.logsDir();
    if (!fs.existsSync(dir)) {
      const pick = await vscode.window.showWarningMessage(`Logs folder does not exist yet: ${dir}`, 'Create it', 'Open Settings');
      if (pick === 'Create it') fs.mkdirSync(dir, { recursive: true });
      else if (pick === 'Open Settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'scriptProgress.logsPath');
      else return;
    }
    const target = fs.existsSync(path.join(dir, FILES.progress)) ? vscode.Uri.file(path.join(dir, FILES.progress)) : vscode.Uri.file(dir);
    await vscode.commands.executeCommand('revealFileInOS', target);
  });

  reg('scriptProgress.showHistory', () => {
    if (!historyChannel) historyChannel = vscode.window.createOutputChannel('Script Progress History');
    const ch = historyChannel;
    ch.clear();
    const data = cx.getData();
    const runs = data.history.slice().sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
    ch.appendLine(`Run history — ${runs.length} run(s) from ${path.join(cx.logsDir(), FILES.history)}`);
    ch.appendLine('');
    for (const run of runs) {
      const tag = run.success ? 'PASS' : 'FAIL';
      const warn = run.warnings ? ` | ${run.warnings} warning(s)` : '';
      const metrics = run.metrics && Object.keys(run.metrics).length ? ` | ${Object.entries(run.metrics).map(([k, v]) => `${k}=${v}`).join(', ')}` : '';
      ch.appendLine(`[${tag}] ${dateTime(run.date)} | ${run.task} | ${formatDuration(run.elapsed)}${warn} | ${run.summary ?? ''}${metrics}`);
    }
    ch.show(true);
  });

  reg('scriptProgress.runQuickAction', async (arg?: unknown) => {
    const s = cx.getSettings();
    if (!s.buttons.length) {
      const pick = await vscode.window.showInformationMessage('No Quick Actions configured yet.', 'Open Settings');
      if (pick) await vscode.commands.executeCommand('workbench.action.openSettings', 'scriptProgress.quickActions.buttons');
      return;
    }
    let button = typeof arg === 'string' ? s.buttons.find(b => b.label === arg) : undefined;
    if (!button) {
      const items = s.buttons.map(b => ({ label: `$(${b.icon || 'play'}) ${b.label}`, description: b.group, detail: b.command, b }));
      const pick = await vscode.window.showQuickPick(items, { title: 'Script Progress: Run Quick Action', placeHolder: 'Choose a button to run', matchOnDetail: true });
      button = pick?.b;
    }
    if (button) await cx.runner.runButton(button);
  });

  reg('scriptProgress.runFile', async (arg?: unknown) => {
    const uri = arg instanceof vscode.Uri ? arg : undefined;
    const file = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!file) { void vscode.window.showInformationMessage('Open or select a script file first.'); return; }
    const cmd = commandForFile(file, cx.getSettings().quickActions.interpreters);
    if (!cmd) { void vscode.window.showInformationMessage(`No interpreter configured for ${path.extname(file)} — see scriptProgress.quickActions.interpreters.`); return; }
    await cx.runner.runCommand(cmd, path.basename(file));
  });

  reg('scriptProgress.copyDailySummary', async () => {
    const text = dailySummaryText(cx.getData(), cx.getSettings(), new Date());
    await vscode.env.clipboard.writeText(text);
    const pick = await vscode.window.showInformationMessage('Daily summary copied to the clipboard.', 'Show it');
    if (pick) {
      const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
      await vscode.window.showTextDocument(doc, { preview: true });
    }
  });

  reg('scriptProgress.exportHistoryCsv', async () => {
    const data = cx.getData();
    if (!data.history.length) { void vscode.window.showInformationMessage('No run history to export yet.'); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(cx.logsDir(), `run_history-${stamp}.csv`)),
      filters: { CSV: ['csv'] }, title: 'Export run history',
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(historyCsv(data.history), 'utf-8'));
    const pick = await vscode.window.showInformationMessage(`Exported ${data.history.length} runs to ${path.basename(target.fsPath)}.`, 'Open');
    if (pick) await vscode.window.showTextDocument(target);
  });


  reg('scriptProgress.copyWeeklyDigest', async () => {
    const text = weeklyDigestText(cx.getData(), cx.getSettings(), new Date());
    await vscode.env.clipboard.writeText(text);
    const pick = await vscode.window.showInformationMessage('Weekly digest copied to the clipboard.', 'Show it');
    if (pick) {
      const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
      await vscode.window.showTextDocument(doc, { preview: true });
    }
  });

  reg('scriptProgress.compareRuns', async (preselected?: unknown) => {
    const data = cx.getData();
    if (data.history.length < 2) { void vscode.window.showInformationMessage('Two runs are needed to compare. There are fewer than two in history.'); return; }
    const newestFirst = data.history.slice().sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
    const item = (r: RunRecord) => ({
      label: `${r.success ? '$(check)' : '$(error)'} ${r.task}`,
      description: `${dateTime(r.date)} · ${formatDuration(Number(r.elapsed) || 0)}${r.warnings ? ` · ${r.warnings} warning(s)` : ''}`,
      detail: r.summary || undefined,
      run: r,
    });

    // Called from a Run History row: that run is the subject, and we only ask what to compare to.
    let subject = typeof preselected === 'string' ? newestFirst.find(r => runKey(r) === preselected) : undefined;
    if (!subject) {
      const pick = await vscode.window.showQuickPick(newestFirst.map(item), { title: 'Compare runs (1 of 2): the run you are looking at', matchOnDescription: true });
      if (!pick) return;
      subject = pick.run;
    }
    const others = newestFirst.filter(r => r !== subject);
    const suggested = defaultBaseline(subject, data.history);
    const choices = others.map(item);
    if (suggested) {
      const i = choices.findIndex(c => c.run === suggested);
      if (i >= 0) { choices[i] = { ...choices[i], label: `${choices[i].label}  $(star-full)`, detail: `Previous run of this task${choices[i].detail ? ' · ' + choices[i].detail : ''}` }; choices.unshift(choices.splice(i, 1)[0]); }
    }
    const against = await vscode.window.showQuickPick(choices, { title: `Compare "${subject.task}" against…`, matchOnDescription: true });
    if (!against) return;

    // Baseline first, so the numbers read as "what changed since then".
    const cmp = compareRuns(against.run, subject);
    const doc = await vscode.workspace.openTextDocument({ content: comparisonText(cmp), language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: true });
  });

  reg('scriptProgress.importDeltas', async () => {
    const picked = await vscode.window.showOpenDialog({
      title: 'Import delta history', canSelectMany: false, filters: { JSON: ['json'] },
      openLabel: 'Import',
    });
    if (!picked || !picked[0]) return;
    let incoming: unknown;
    try {
      incoming = JSON.parse(fs.readFileSync(picked[0].fsPath, 'utf-8'));
    } catch (e) {
      void vscode.window.showErrorMessage(`Could not read that file: ${(e as Error).message}`);
      return;
    }
    // Accept either a bare array for one metric, or { metric: [...] } for several.
    const series: Record<string, unknown[]> = Array.isArray(incoming)
      ? {}
      : (incoming && typeof incoming === 'object') ? incoming as Record<string, unknown[]> : {};
    if (Array.isArray(incoming)) {
      const name = await vscode.window.showInputBox({ title: 'Import delta history', prompt: 'Which metric are these points for?', placeHolder: 'e.g. reconciliation_delta' });
      if (!name) return;
      series[name] = incoming;
    }
    const file = path.join(cx.logsDir(), FILES.deltas);
    let existing: Record<string, DeltaPoint[]> = {};
    try { existing = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { existing = {}; }
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) existing = {};

    let added = 0, skipped = 0, rejected = 0;
    for (const [name, pts] of Object.entries(series)) {
      if (!Array.isArray(pts)) { rejected++; continue; }
      const current = Array.isArray(existing[name]) ? existing[name] : [];
      // Never replace what is already there, and never import the same point twice.
      const seen = new Set(current.map(p => `${p.date}|${p.value}`));
      for (const raw of pts) {
        const p = raw as Partial<DeltaPoint>;
        const value = Number(p?.value);
        if (!p || typeof p.date !== 'string' || !isFinite(value)) { rejected++; continue; }
        const key = `${p.date}|${value}`;
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
        current.push({ date: p.date, value, task: typeof p.task === 'string' ? p.task : 'imported' });
        added++;
      }
      current.sort((a, b) => (parseIso(a.date)?.getTime() ?? 0) - (parseIso(b.date)?.getTime() ?? 0));
      existing[name] = current;
    }
    if (!added) {
      void vscode.window.showWarningMessage(`Nothing imported. ${skipped} point(s) were already there, ${rejected} could not be read (each needs a "date" and a numeric "value").`);
      return;
    }
    try {
      fs.mkdirSync(cx.logsDir(), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(existing, null, 2), 'utf-8');
    } catch (e) {
      void vscode.window.showErrorMessage(`Could not write ${FILES.deltas}: ${(e as Error).message}`);
      return;
    }
    cx.refresh(true);
    void vscode.window.showInformationMessage(`Imported ${added} point(s) into ${FILES.deltas}${skipped ? `, skipped ${skipped} already present` : ''}${rejected ? `, ${rejected} unreadable` : ''}.`);
  });

  reg('scriptProgress.exportReport', async () => {
    const data = cx.getData();
    const stamp = new Date().toISOString().slice(0, 10);
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(cx.logsDir(), `script-progress-report-${stamp}.html`)),
      filters: { HTML: ['html'] }, title: 'Export a shareable HTML report',
    });
    if (!target) return;
    const read = (...p: string[]) => { try { return fs.readFileSync(vscode.Uri.joinPath(cx.extensionUri, 'media', ...p).fsPath, 'utf-8'); } catch { return ''; } };
    const css = [read('dashboard.css'), read('sections', 'timeline.css'), read('sections', 'metrics.css'), read('sections', 'warningTrends.css')].join('\n');
    const html = reportHtml(data, cx.getSettings(), new Date()).replace('__DASHBOARD_CSS__', () => css);
    await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf-8'));
    const pick = await vscode.window.showInformationMessage(`Report written to ${path.basename(target.fsPath)}.`, 'Open in browser', 'Reveal');
    if (pick === 'Open in browser') await vscode.env.openExternal(target);
    else if (pick === 'Reveal') await vscode.commands.executeCommand('revealFileInOS', target);
  });

  reg('scriptProgress.archiveHistory', async () => {
    const file = path.join(cx.logsDir(), FILES.history);
    if (!fs.existsSync(file)) { void vscode.window.showInformationMessage('No run history file to archive.'); return; }
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const dest = path.join(cx.logsDir(), `run_history-${stamp}.json`);
    fs.copyFileSync(file, dest);
    void vscode.window.showInformationMessage(`Copied run history to ${path.basename(dest)}. The live file is unchanged.`);
  });

  reg('scriptProgress.clearHistory', async () => {
    const file = path.join(cx.logsDir(), FILES.history);
    const n = cx.getData().history.length;
    const pick = await vscode.window.showWarningMessage(`Clear all ${n} run(s) from run_history.json? A backup copy is written first.`, { modal: true }, 'Archive and clear');
    if (pick !== 'Archive and clear') return;
    if (fs.existsSync(file)) {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      fs.copyFileSync(file, path.join(cx.logsDir(), `run_history-${stamp}.json`));
      fs.writeFileSync(file, '[]\n', 'utf-8');
    }
    cx.refresh(true);
  });

  reg('scriptProgress.toggleSections', async () => {
    const s = cx.getSettings();
    const items = ALL_SECTIONS.map(id => ({ label: SECTION_TITLES[id], id, picked: s.sections[id] }));
    const picked = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Script Progress: dashboard sections', placeHolder: 'Tick the sections to show' });
    if (!picked) return;
    const on = new Set(picked.map(p => p.id));
    const cfg = vscode.workspace.getConfiguration('scriptProgress');
    const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    const changed = (ALL_SECTIONS as SectionId[]).filter(id => s.sections[id] !== on.has(id));
    try {
      for (const id of changed) await cfg.update(`sections.${id}`, on.has(id), target);
    } catch (e) {
      // VS Code refuses the write when the target file will not parse, is read-only or has
      // unsaved edits — and its raw message says none of that in a way anyone can act on.
      if (target === vscode.ConfigurationTarget.Global) { void vscode.window.showErrorMessage(`Could not save the section settings: ${(e as Error).message}`); return; }
      const USER = 'Save to User settings';
      const OPEN = 'Open settings file';
      const pick = await vscode.window.showErrorMessage(
        'Could not write your workspace settings. Usually that means the settings file has a JSON error, is read-only, or has unsaved changes.',
        USER, OPEN,
      );
      if (pick === USER) {
        try {
          for (const id of changed) await cfg.update(`sections.${id}`, on.has(id), vscode.ConfigurationTarget.Global);
          void vscode.window.showInformationMessage('Saved to your User settings instead.');
        } catch (e2) { void vscode.window.showErrorMessage(`User settings could not be written either: ${(e2 as Error).message}`); }
      } else if (pick === OPEN) {
        await vscode.commands.executeCommand('workbench.action.openWorkspaceSettingsFile');
      }
    }
  });

  reg('scriptProgress.simulateRun', async (mode?: unknown) => {
    const dir = cx.logsDir();
    try {
      await simulateRun(dir, cx.getData(), cx.getSettings().staleRunningMinutes, mode === 'fail' ? 'fail' : 'ok');
    } catch (e) {
      void vscode.window.showErrorMessage(`Simulation could not write to ${dir}: ${(e as Error).message}`);
    }
  });

  reg('scriptProgress.statusMenu', async () => {
    const data = cx.getData();
    const s = cx.getSettings();
    const now = new Date();
    const running = data.tasks.filter(t => taskState(t, s.staleRunningMinutes, now, data.overlays) === 'running');
    const items: (vscode.QuickPickItem & { run?: () => unknown })[] = [];
    for (const t of running) items.push({ label: `$(sync~spin) ${t.task}`, description: `${t.step}/${t.totalSteps} ${t.label}`, detail: t.detail });
    if (running.length) items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(dashboard) Open Dashboard', run: () => vscode.commands.executeCommand('scriptProgress.openPanel') });
    items.push({ label: '$(graph) Open Access Map', run: () => vscode.commands.executeCommand('scriptProgress.openMap') });
    if (s.buttons.length) items.push({ label: '$(play) Run Quick Action…', run: () => vscode.commands.executeCommand('scriptProgress.runQuickAction') });
    items.push({ label: '$(clippy) Copy Daily Summary', run: () => vscode.commands.executeCommand('scriptProgress.copyDailySummary') });
    items.push({ label: '$(mail) Copy Weekly Digest', run: () => vscode.commands.executeCommand('scriptProgress.copyWeeklyDigest') });
    items.push({ label: '$(git-compare) Compare Two Runs…', run: () => vscode.commands.executeCommand('scriptProgress.compareRuns') });
    items.push({ label: '$(file-pdf) Export HTML Report', run: () => vscode.commands.executeCommand('scriptProgress.exportReport') });
    items.push({ label: '$(history) Show Run History', run: () => vscode.commands.executeCommand('scriptProgress.showHistory') });
    items.push({ label: '$(folder-opened) Open Logs Folder', run: () => vscode.commands.executeCommand('scriptProgress.openLogsFolder') });
    items.push({ label: '$(settings-gear) Settings', run: () => vscode.commands.executeCommand('scriptProgress.openSettings') });
    const pick = await vscode.window.showQuickPick(items, { title: 'Script Progress', placeHolder: running.length ? `${running.length} running` : 'Nothing running' });
    if (pick?.run) await pick.run();
  });
}

export function disposeCommands(): void {
  historyChannel?.dispose();
  historyChannel = undefined;
}
