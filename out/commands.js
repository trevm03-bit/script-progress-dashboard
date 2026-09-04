"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCommands = registerCommands;
exports.disposeCommands = disposeCommands;
// Every command the extension registers, in one place. Thin: the logic lives in logic/ and the
// state comes from the StateProvider so commands never hold data of their own.
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const actions_1 = require("./actions");
const dashboardPanel_1 = require("./dashboardPanel");
const dataReader_1 = require("./dataReader");
const summary_1 = require("./logic/summary");
const compare_1 = require("./logic/compare");
const compareText_1 = require("./logic/compareText");
const time_1 = require("./logic/time");
const simulate_1 = require("./simulate");
const report_1 = require("./logic/report");
const digestHtml_1 = require("./logic/digestHtml");
const runbook_1 = require("./logic/runbook");
const richClipboard_1 = require("./richClipboard");
const types_1 = require("./types");
let historyChannel;
function registerCommands(context, cx) {
    const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
    reg('scriptProgress.openPanel', () => dashboardPanel_1.DashboardPanel.createOrShow(cx.extensionUri, cx, 'panel'));
    reg('scriptProgress.openMap', () => dashboardPanel_1.DashboardPanel.createOrShow(cx.extensionUri, cx, 'map'));
    reg('scriptProgress.focusSidebar', () => vscode.commands.executeCommand('scriptProgress.dashboard.focus'));
    reg('scriptProgress.refresh', () => cx.refresh(true));
    reg('scriptProgress.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:trevor-marshall.script-progress-dashboard'));
    reg('scriptProgress.openWalkthrough', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', 'trevor-marshall.script-progress-dashboard#scriptProgress.gettingStarted', false));
    reg('scriptProgress.openLogsFolder', async () => {
        const dir = cx.logsDir();
        if (!fs.existsSync(dir)) {
            const pick = await vscode.window.showWarningMessage(`Logs folder does not exist yet: ${dir}`, 'Create it', 'Open Settings');
            if (pick === 'Create it')
                fs.mkdirSync(dir, { recursive: true });
            else if (pick === 'Open Settings')
                await vscode.commands.executeCommand('workbench.action.openSettings', 'scriptProgress.logsPath');
            else
                return;
        }
        const target = fs.existsSync(path.join(dir, dataReader_1.FILES.progress)) ? vscode.Uri.file(path.join(dir, dataReader_1.FILES.progress)) : vscode.Uri.file(dir);
        await vscode.commands.executeCommand('revealFileInOS', target);
    });
    reg('scriptProgress.showHistory', () => {
        if (!historyChannel)
            historyChannel = vscode.window.createOutputChannel('Script Progress History');
        const ch = historyChannel;
        ch.clear();
        const data = cx.getData();
        const runs = data.history.slice().sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0));
        ch.appendLine(`Run history — ${runs.length} run(s) from ${path.join(cx.logsDir(), dataReader_1.FILES.history)}`);
        ch.appendLine('');
        for (const run of runs) {
            const tag = run.success ? 'PASS' : 'FAIL';
            const warn = run.warnings ? ` | ${run.warnings} warning(s)` : '';
            const metrics = run.metrics && Object.keys(run.metrics).length ? ` | ${Object.entries(run.metrics).map(([k, v]) => `${k}=${v}`).join(', ')}` : '';
            ch.appendLine(`[${tag}] ${(0, time_1.dateTime)(run.date)} | ${run.task} | ${(0, time_1.formatDuration)(run.elapsed)}${warn} | ${run.summary ?? ''}${metrics}`);
        }
        ch.show(true);
    });
    reg('scriptProgress.runQuickAction', async (arg) => {
        const s = cx.getSettings();
        if (!s.buttons.length) {
            const pick = await vscode.window.showInformationMessage('No Quick Actions configured yet.', 'Open Settings');
            if (pick)
                await vscode.commands.executeCommand('workbench.action.openSettings', 'scriptProgress.quickActions.buttons');
            return;
        }
        let button = typeof arg === 'string' ? s.buttons.find(b => b.label === arg) : undefined;
        if (!button) {
            const items = s.buttons.map(b => ({ label: `$(${b.icon || 'play'}) ${b.label}`, description: b.group, detail: b.command, b }));
            const pick = await vscode.window.showQuickPick(items, { title: 'Script Progress: Run Quick Action', placeHolder: 'Choose a button to run', matchOnDetail: true });
            button = pick?.b;
        }
        if (button)
            await cx.runner.runButton(button);
    });
    reg('scriptProgress.runFile', async (arg) => {
        const uri = arg instanceof vscode.Uri ? arg : undefined;
        const file = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!file) {
            void vscode.window.showInformationMessage('Open or select a script file first.');
            return;
        }
        const cmd = (0, actions_1.commandForFile)(file, cx.getSettings().quickActions.interpreters);
        if (!cmd) {
            void vscode.window.showInformationMessage(`No interpreter configured for ${path.extname(file)} — see scriptProgress.quickActions.interpreters.`);
            return;
        }
        await cx.runner.runCommand(cmd, path.basename(file));
    });
    reg('scriptProgress.copyDailySummary', async () => {
        const text = (0, summary_1.dailySummaryText)(cx.getData(), cx.getSettings(), new Date());
        await vscode.env.clipboard.writeText(text);
        const pick = await vscode.window.showInformationMessage('Daily summary copied to the clipboard.', 'Show it');
        if (pick) {
            const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
            await vscode.window.showTextDocument(doc, { preview: true });
        }
    });
    reg('scriptProgress.exportHistoryCsv', async () => {
        const data = cx.getData();
        if (!data.history.length) {
            void vscode.window.showInformationMessage('No run history to export yet.');
            return;
        }
        const stamp = new Date().toISOString().slice(0, 10);
        const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(cx.logsDir(), `run_history-${stamp}.csv`)),
            filters: { CSV: ['csv'] }, title: 'Export run history',
        });
        if (!target)
            return;
        await vscode.workspace.fs.writeFile(target, Buffer.from((0, summary_1.historyCsv)(data.history), 'utf-8'));
        const pick = await vscode.window.showInformationMessage(`Exported ${data.history.length} runs to ${path.basename(target.fsPath)}.`, 'Open');
        if (pick)
            await vscode.window.showTextDocument(target);
    });
    reg('scriptProgress.copyWeeklyDigest', async () => {
        const text = (0, summary_1.weeklyDigestText)(cx.getData(), cx.getSettings(), new Date());
        await vscode.env.clipboard.writeText(text);
        const pick = await vscode.window.showInformationMessage('Weekly digest copied to the clipboard.', 'Show it');
        if (pick) {
            const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
            await vscode.window.showTextDocument(doc, { preview: true });
        }
    });
    reg('scriptProgress.compareRuns', async (preselected) => {
        const data = cx.getData();
        if (data.history.length < 2) {
            void vscode.window.showInformationMessage('Two runs are needed to compare. There are fewer than two in history.');
            return;
        }
        const newestFirst = data.history.slice().sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0));
        const item = (r) => ({
            label: `${r.success ? '$(check)' : '$(error)'} ${r.task}`,
            description: `${(0, time_1.dateTime)(r.date)} · ${(0, time_1.formatDuration)(Number(r.elapsed) || 0)}${r.warnings ? ` · ${r.warnings} warning(s)` : ''}`,
            detail: r.summary || undefined,
            run: r,
        });
        // Called from a Run History row: that run is the subject, and we only ask what to compare to.
        let subject = typeof preselected === 'string' ? newestFirst.find(r => (0, compare_1.runKey)(r) === preselected) : undefined;
        if (!subject) {
            const pick = await vscode.window.showQuickPick(newestFirst.map(item), { title: 'Compare runs (1 of 2): the run you are looking at', matchOnDescription: true });
            if (!pick)
                return;
            subject = pick.run;
        }
        const others = newestFirst.filter(r => r !== subject);
        const suggested = (0, compare_1.defaultBaseline)(subject, data.history);
        const choices = others.map(item);
        if (suggested) {
            const i = choices.findIndex(c => c.run === suggested);
            if (i >= 0) {
                choices[i] = { ...choices[i], label: `${choices[i].label}  $(star-full)`, detail: `Previous run of this task${choices[i].detail ? ' · ' + choices[i].detail : ''}` };
                choices.unshift(choices.splice(i, 1)[0]);
            }
        }
        const against = await vscode.window.showQuickPick(choices, { title: `Compare "${subject.task}" against…`, matchOnDescription: true });
        if (!against)
            return;
        // Baseline first, so the numbers read as "what changed since then".
        const cmp = (0, compare_1.compareRuns)(against.run, subject);
        const doc = await vscode.workspace.openTextDocument({ content: (0, compareText_1.comparisonText)(cmp), language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
    });
    reg('scriptProgress.importDeltas', async () => {
        const picked = await vscode.window.showOpenDialog({
            title: 'Import delta history', canSelectMany: false, filters: { JSON: ['json'] },
            openLabel: 'Import',
        });
        if (!picked || !picked[0])
            return;
        let incoming;
        try {
            incoming = JSON.parse(fs.readFileSync(picked[0].fsPath, 'utf-8'));
        }
        catch (e) {
            void vscode.window.showErrorMessage(`Could not read that file: ${e.message}`);
            return;
        }
        // Accept either a bare array for one metric, or { metric: [...] } for several.
        const series = Array.isArray(incoming)
            ? {}
            : (incoming && typeof incoming === 'object') ? incoming : {};
        if (Array.isArray(incoming)) {
            const name = await vscode.window.showInputBox({ title: 'Import delta history', prompt: 'Which metric are these points for?', placeHolder: 'e.g. reconciliation_delta' });
            if (!name)
                return;
            series[name] = incoming;
        }
        const file = path.join(cx.logsDir(), dataReader_1.FILES.deltas);
        let existing = {};
        try {
            existing = JSON.parse(fs.readFileSync(file, 'utf-8'));
        }
        catch {
            existing = {};
        }
        if (!existing || typeof existing !== 'object' || Array.isArray(existing))
            existing = {};
        let added = 0, skipped = 0, rejected = 0;
        for (const [name, pts] of Object.entries(series)) {
            if (!Array.isArray(pts)) {
                rejected++;
                continue;
            }
            const current = Array.isArray(existing[name]) ? existing[name] : [];
            // Never replace what is already there, and never import the same point twice.
            const seen = new Set(current.map(p => `${p.date}|${p.value}`));
            for (const raw of pts) {
                const p = raw;
                const value = Number(p?.value);
                if (!p || typeof p.date !== 'string' || !isFinite(value)) {
                    rejected++;
                    continue;
                }
                const key = `${p.date}|${value}`;
                if (seen.has(key)) {
                    skipped++;
                    continue;
                }
                seen.add(key);
                current.push({ date: p.date, value, task: typeof p.task === 'string' ? p.task : 'imported' });
                added++;
            }
            current.sort((a, b) => ((0, time_1.parseIso)(a.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(b.date)?.getTime() ?? 0));
            existing[name] = current;
        }
        if (!added) {
            void vscode.window.showWarningMessage(`Nothing imported. ${skipped} point(s) were already there, ${rejected} could not be read (each needs a "date" and a numeric "value").`);
            return;
        }
        try {
            fs.mkdirSync(cx.logsDir(), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(existing, null, 2), 'utf-8');
        }
        catch (e) {
            void vscode.window.showErrorMessage(`Could not write ${dataReader_1.FILES.deltas}: ${e.message}`);
            return;
        }
        cx.refresh(true);
        void vscode.window.showInformationMessage(`Imported ${added} point(s) into ${dataReader_1.FILES.deltas}${skipped ? `, skipped ${skipped} already present` : ''}${rejected ? `, ${rejected} unreadable` : ''}.`);
    });
    reg('scriptProgress.generateRunbook', async () => {
        const text = (0, runbook_1.runbookMarkdown)(cx.getData(), cx.getSettings(), new Date());
        const doc = await vscode.workspace.openTextDocument({ content: text, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: false });
        void vscode.window.showInformationMessage('Runbook generated from observed runs. Fill in the ⚠️ gaps — anything a person does between steps is invisible to this tool.');
    });
    reg('scriptProgress.copyDigestHtml', async () => {
        const html = (0, digestHtml_1.digestHtml)(cx.getData(), cx.getSettings(), new Date());
        const rich = await (0, richClipboard_1.copyHtmlRich)(html);
        if (rich.ok) {
            void vscode.window.showInformationMessage('Digest copied as formatted text — paste straight into an email.');
            return;
        }
        // Rich paste is Windows-only and can be blocked outright. Rather than silently leaving
        // markup on the clipboard (which pastes as a wall of tags), open the rendered page so it can
        // be copied from there — a browser puts real formatted text on the clipboard.
        // A predictable name in the shared temp directory is a symlink target on any multi-user
        // machine, and the digest itself (script names, failures, totals) should not be world
        // readable. A fresh private directory, owner-only, and refuse to overwrite anything.
        let file;
        try {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-progress-'));
            file = path.join(dir, 'digest.html');
            fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>Digest</title>${html}`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
        }
        catch (e) {
            void vscode.window.showErrorMessage(`Could not write the digest: ${e.message}`);
            return;
        }
        const OPEN = 'Open it';
        const pick = await vscode.window.showInformationMessage(`Formatted copy is not available here (${rich.reason}). The digest has been written to a file — open it, select all and copy to paste it with its formatting.`, OPEN);
        if (pick === OPEN)
            await vscode.env.openExternal(vscode.Uri.file(file));
    });
    reg('scriptProgress.chooseLayout', async () => {
        // Each preset is a strict superset of the one before, and the middle one IS the shipped
        // default — otherwise the picker offers no option describing what the user already has,
        // which is exactly how the three numbers in this feature became confusing.
        // Presets rather than a second extension. The difference between "track my scripts" and a
        // full operations view is which sections are on, so it is one command — not a fork, and not
        // fifteen checkboxes for someone who has just installed it.
        const ESSENTIALS = ['summary', 'activeTask', 'pendingActions', 'warnings', 'lastCompleted', 'runHistory', 'timeline'];
        const LAYOUTS = [
            {
                label: '$(list-flat) Essentials',
                detail: 'Just what is running and what happened — progress, warnings, history, timeline.',
                on: [...ESSENTIALS],
            },
            {
                label: '$(dashboard) Operations',
                detail: 'Essentials plus the schedule and script health. This is the default.',
                on: [...ESSENTIALS, 'processCalendar', 'scriptHealth'],
            },
            {
                label: '$(three-bars) Everything',
                detail: 'Every section, including the Access Map, Metrics Explorer and Impact Summary.',
                on: [...types_1.ALL_SECTIONS],
            },
        ];
        const current = new Set(types_1.ALL_SECTIONS.filter(id => cx.getSettings().sections[id]));
        const same = (l) => l.length === current.size && l.every(id => current.has(id));
        const pick = await vscode.window.showQuickPick(LAYOUTS.map(l => ({
            label: l.label + (same(l.on) ? '  $(check)' : ''),
            description: `${l.on.length} of ${types_1.ALL_SECTIONS.length} sections${same(l.on) ? ' · current' : ''}`,
            detail: l.detail,
            layout: l,
        })), { title: 'Choose a layout', placeHolder: 'You can still turn individual sections on and off afterwards' });
        if (!pick)
            return;
        const wanted = new Set(pick.layout.on);
        const cfg = vscode.workspace.getConfiguration('scriptProgress');
        const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        // Write only what actually changes. Writing all fifteen keys fired fifteen configuration
        // events - so fifteen forced re-renders and fifteen poll restarts for one menu pick - and
        // pinned every section explicitly in settings.json, freezing the user out of any future
        // change to the defaults. A partial failure is also reported honestly: some of it landed.
        const cur = cx.getSettings().sections;
        const changed = types_1.ALL_SECTIONS.filter(id => cur[id] !== wanted.has(id));
        let done = 0;
        try {
            for (const id of changed) {
                await cfg.update(`sections.${id}`, wanted.has(id), target);
                done++;
            }
        }
        catch (e) {
            void vscode.window.showErrorMessage(done
                ? `The layout was only partly saved (${done} of ${changed.length} sections): ${e.message}`
                : `Could not save the layout: ${e.message}`);
            return;
        }
        const needsSetup = ['processCalendar', 'quickActions'].filter(id => wanted.has(id));
        void vscode.window.showInformationMessage(`Layout set.${needsSetup.length ? ' Process Calendar and Quick Actions need a little configuration before they show anything.' : ''}`, ...(needsSetup.length ? ['Open Settings'] : [])).then(p2 => { if (p2)
            void vscode.commands.executeCommand('scriptProgress.openSettings'); });
    });
    reg('scriptProgress.exportReport', async () => {
        const data = cx.getData();
        const stamp = new Date().toISOString().slice(0, 10);
        const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(cx.logsDir(), `script-progress-report-${stamp}.html`)),
            filters: { HTML: ['html'] }, title: 'Export a shareable HTML report',
        });
        if (!target)
            return;
        const read = (...p) => { try {
            return fs.readFileSync(vscode.Uri.joinPath(cx.extensionUri, 'media', ...p).fsPath, 'utf-8');
        }
        catch {
            return '';
        } };
        const css = [read('dashboard.css'), read('sections', 'timeline.css'), read('sections', 'metrics.css'), read('sections', 'warningTrends.css')].join('\n');
        const html = (0, report_1.reportHtml)(data, cx.getSettings(), new Date()).replace('__DASHBOARD_CSS__', () => css);
        await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf-8'));
        const pick = await vscode.window.showInformationMessage(`Report written to ${path.basename(target.fsPath)}.`, 'Open in browser', 'Reveal');
        if (pick === 'Open in browser')
            await vscode.env.openExternal(target);
        else if (pick === 'Reveal')
            await vscode.commands.executeCommand('revealFileInOS', target);
    });
    reg('scriptProgress.archiveHistory', async () => {
        const file = path.join(cx.logsDir(), dataReader_1.FILES.history);
        if (!fs.existsSync(file)) {
            void vscode.window.showInformationMessage('No run history file to archive.');
            return;
        }
        const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        const dest = path.join(cx.logsDir(), `run_history-${stamp}.json`);
        fs.copyFileSync(file, dest);
        void vscode.window.showInformationMessage(`Copied run history to ${path.basename(dest)}. The live file is unchanged.`);
    });
    reg('scriptProgress.clearHistory', async () => {
        const file = path.join(cx.logsDir(), dataReader_1.FILES.history);
        const n = cx.getData().history.length;
        const pick = await vscode.window.showWarningMessage(`Clear all ${n} run(s) from run_history.json? A backup copy is written first.`, { modal: true }, 'Archive and clear');
        if (pick !== 'Archive and clear')
            return;
        if (fs.existsSync(file)) {
            const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
            fs.copyFileSync(file, path.join(cx.logsDir(), `run_history-${stamp}.json`));
            fs.writeFileSync(file, '[]\n', 'utf-8');
        }
        cx.refresh(true);
    });
    reg('scriptProgress.toggleSections', async () => {
        const s = cx.getSettings();
        const items = types_1.ALL_SECTIONS.map(id => ({ label: types_1.SECTION_TITLES[id], id, picked: s.sections[id] }));
        const picked = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Script Progress: dashboard sections', placeHolder: 'Tick the sections to show' });
        if (!picked)
            return;
        const on = new Set(picked.map(p => p.id));
        const cfg = vscode.workspace.getConfiguration('scriptProgress');
        const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        const changed = types_1.ALL_SECTIONS.filter(id => s.sections[id] !== on.has(id));
        try {
            for (const id of changed)
                await cfg.update(`sections.${id}`, on.has(id), target);
        }
        catch (e) {
            // VS Code refuses the write when the target file will not parse, is read-only or has
            // unsaved edits — and its raw message says none of that in a way anyone can act on.
            if (target === vscode.ConfigurationTarget.Global) {
                void vscode.window.showErrorMessage(`Could not save the section settings: ${e.message}`);
                return;
            }
            const USER = 'Save to User settings';
            const OPEN = 'Open settings file';
            const pick = await vscode.window.showErrorMessage('Could not write your workspace settings. Usually that means the settings file has a JSON error, is read-only, or has unsaved changes.', USER, OPEN);
            if (pick === USER) {
                try {
                    for (const id of changed)
                        await cfg.update(`sections.${id}`, on.has(id), vscode.ConfigurationTarget.Global);
                    void vscode.window.showInformationMessage('Saved to your User settings instead.');
                }
                catch (e2) {
                    void vscode.window.showErrorMessage(`User settings could not be written either: ${e2.message}`);
                }
            }
            else if (pick === OPEN) {
                await vscode.commands.executeCommand('workbench.action.openWorkspaceSettingsFile');
            }
        }
    });
    /**
     * Open the reporter that ships inside the extension, so it can be read and copied.
     *
     * Until this existed, "copy the reporter into your project" was an instruction with nowhere to
     * click: the file lives inside the installed extension folder, which nobody can be expected to
     * find. It also gives the walkthrough's third step something to complete on - without a command
     * link or a completionEvent a step stays open for ever, so the walkthrough could never reach
     * 100% however much of it you actually did.
     */
    reg('scriptProgress.openReporter', async () => {
        const langs = [
            { label: 'Python', file: 'python/progress.py', detail: 'progress.py — standard library only, Python 3.10+' },
            { label: 'Node', file: 'reporters/progress.js', detail: 'progress.js — no dependencies, CommonJS' },
        ];
        const pick = langs.length === 1 ? langs[0] : await vscode.window.showQuickPick(langs.map(l => ({ label: l.label, detail: l.detail, l })), { title: 'Open the reporter', placeHolder: 'Copy this file into your project and import it' }).then(x => x?.l);
        if (!pick)
            return;
        const uri = vscode.Uri.joinPath(cx.extensionUri, ...pick.file.split('/'));
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
            void vscode.window.showInformationMessage(`This is the bundled ${pick.label} reporter. Save a copy into your project (somewhere like scripts/lib/) and import it from your scripts.`);
        }
        catch (e) {
            void vscode.window.showErrorMessage(`Could not open the ${pick.label} reporter: ${e.message}`);
        }
    });
    reg('scriptProgress.simulateRun', async (mode) => {
        const dir = cx.logsDir();
        try {
            await (0, simulate_1.simulateRun)(dir, cx.getData(), cx.getSettings().staleRunningMinutes, mode === 'fail' ? 'fail' : 'ok');
        }
        catch (e) {
            void vscode.window.showErrorMessage(`Simulation could not write to ${dir}: ${e.message}`);
        }
    });
    reg('scriptProgress.statusMenu', async () => {
        const data = cx.getData();
        const s = cx.getSettings();
        const now = new Date();
        const running = data.tasks.filter(t => (0, time_1.taskState)(t, s.staleRunningMinutes, now, data.overlays) === 'running');
        const items = [];
        for (const t of running)
            items.push({ label: `$(sync~spin) ${t.task}`, description: `${t.step}/${t.totalSteps} ${t.label}`, detail: t.detail });
        if (running.length)
            items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({ label: '$(dashboard) Open Dashboard', run: () => vscode.commands.executeCommand('scriptProgress.openPanel') });
        items.push({ label: '$(graph) Open Access Map', run: () => vscode.commands.executeCommand('scriptProgress.openMap') });
        if (s.buttons.length)
            items.push({ label: '$(play) Run Quick Action…', run: () => vscode.commands.executeCommand('scriptProgress.runQuickAction') });
        items.push({ label: '$(clippy) Copy Daily Summary', run: () => vscode.commands.executeCommand('scriptProgress.copyDailySummary') });
        items.push({ label: '$(mail) Copy Weekly Digest', run: () => vscode.commands.executeCommand('scriptProgress.copyWeeklyDigest') });
        items.push({ label: '$(mail) Copy Digest for Email (formatted)', run: () => vscode.commands.executeCommand('scriptProgress.copyDigestHtml') });
        items.push({ label: '$(book) Generate Runbook', run: () => vscode.commands.executeCommand('scriptProgress.generateRunbook') });
        items.push({ label: '$(git-compare) Compare Two Runs…', run: () => vscode.commands.executeCommand('scriptProgress.compareRuns') });
        items.push({ label: '$(file-pdf) Export HTML Report', run: () => vscode.commands.executeCommand('scriptProgress.exportReport') });
        items.push({ label: '$(history) Show Run History', run: () => vscode.commands.executeCommand('scriptProgress.showHistory') });
        items.push({ label: '$(folder-opened) Open Logs Folder', run: () => vscode.commands.executeCommand('scriptProgress.openLogsFolder') });
        items.push({ label: '$(layout) Choose a Layout…', run: () => vscode.commands.executeCommand('scriptProgress.chooseLayout') });
        items.push({ label: '$(settings-gear) Settings', run: () => vscode.commands.executeCommand('scriptProgress.openSettings') });
        const pick = await vscode.window.showQuickPick(items, { title: 'Script Progress', placeHolder: running.length ? `${running.length} running` : 'Nothing running' });
        if (pick?.run)
            await pick.run();
    });
}
function disposeCommands() {
    historyChannel?.dispose();
    historyChannel = undefined;
}
//# sourceMappingURL=commands.js.map