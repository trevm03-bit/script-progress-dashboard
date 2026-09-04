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
exports.StatusBarManager = void 0;
// The status-bar item: one line, always visible. Ticks once a second while a task runs so
// the elapsed time moves even between writes. Click → a menu of actions (or the dashboard).
const vscode = __importStar(require("vscode"));
const time_1 = require("./logic/time");
class StatusBarManager {
    constructor() {
        this.data = null;
        this.settings = null;
        /** Where the reader is looking, for the "nothing yet" tooltip. Set by the extension. */
        this.logsDir = '';
        this.item = vscode.window.createStatusBarItem('scriptProgress.status', vscode.StatusBarAlignment.Left, 100);
        this.item.name = 'Script Progress';
    }
    update(data, settings) {
        this.data = data;
        this.settings = settings;
        this.item.command = settings.statusBar.clickAction === 'menu' ? 'scriptProgress.statusMenu' : 'scriptProgress.openPanel';
        this.render();
        const now = new Date();
        const running = data.tasks.some(t => (0, time_1.taskState)(t, settings.staleRunningMinutes, now, data.overlays) === 'running');
        if (running && !this.timer)
            this.timer = setInterval(() => this.render(), 1000);
        if (!running && this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    render() {
        const data = this.data;
        const settings = this.settings;
        if (!data || !settings || !settings.statusBar.enabled) {
            this.item.hide();
            return;
        }
        const now = new Date();
        const states = data.tasks.map(t => ({ t, s: (0, time_1.taskState)(t, settings.staleRunningMinutes, now, data.overlays) }));
        const running = states.filter(x => x.s === 'running');
        const stalled = states.filter(x => x.s === 'stalled' || x.s === 'exited');
        const md = new vscode.MarkdownString();
        md.supportThemeIcons = true;
        this.item.backgroundColor = undefined;
        if (running.length) {
            const p = running[0].t;
            const step = p.totalSteps > 0 ? `${p.step}/${p.totalSteps} ` : '';
            const more = running.length > 1 ? ` +${running.length - 1}` : '';
            const pct = p.totalSteps > 0 ? ` ${(0, time_1.percent)(p.step, p.totalSteps, p.substep)}%` : '';
            this.item.text = `$(sync~spin) ${step}${truncate(p.label, 28)} · ${(0, time_1.formatDuration)((0, time_1.liveElapsed)(p, now))}${pct}${more}`;
            for (const { t } of running) {
                const eta = (0, time_1.liveEta)(t, now);
                md.appendMarkdown(`**${t.task}** — ${t.label}${t.detail ? ` — ${t.detail}` : ''}\n\nElapsed ${(0, time_1.formatDuration)((0, time_1.liveElapsed)(t, now))}${eta !== null ? ` · ~${(0, time_1.formatDuration)(eta)} left` : ''}${t.warnings?.length ? ` · $(warning) ${t.warnings.length}` : ''}\n\n`);
            }
            if (stalled.length)
                md.appendMarkdown(`$(warning) ${stalled.length} stalled\n\n`);
        }
        else if (stalled.length) {
            const p = stalled[0].t;
            const label = stalled[0].s === 'exited' ? 'Exited' : 'Stalled';
            this.item.text = `$(warning) ${label} ${Math.round((0, time_1.minutesSinceUpdate)(p, now))}m · ${truncate(p.task, 24)}`;
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            md.appendMarkdown(`**${p.task}** still marked running but ${stalled[0].s === 'exited' ? 'its process exited' : `not updated for ${Math.round((0, time_1.minutesSinceUpdate)(p, now))} minutes`}.\n\nLast step: ${p.label}\n\n`);
        }
        else {
            if (settings.statusBar.idleMode === 'hidden') {
                this.item.hide();
                return;
            }
            if (!data.progress) {
                // Nothing has ever reported. Say so rather than showing a bare icon that could equally
                // mean "extension broken" — the tooltip is the only place to answer "is this watching?".
                this.item.text = '$(pulse) Script Progress';
                md.appendMarkdown(`No runs recorded yet.

Watching \`${this.logsHint()}\` for progress files. Run **Script Progress: Simulate a Demo Run** to see it work.

`);
                md.appendMarkdown(settings.statusBar.clickAction === 'menu' ? '_Click for actions_' : '_Click to open the dashboard_');
                this.item.tooltip = md;
                this.item.show();
                return;
            }
            const p = data.progress;
            const state = (0, time_1.taskState)(p, settings.staleRunningMinutes, now, data.overlays);
            if (state === 'failed') {
                this.item.text = `$(error) FAILED ${truncate(p.task, 22)}`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                md.appendMarkdown(`**${p.task}** failed at ${(0, time_1.clockTime)(p.updatedAt)} after ${(0, time_1.formatDuration)(p.elapsed)}${p.detail ? `\n\n${p.detail}` : ''}\n\n`);
            }
            else {
                this.item.text = `$(check) ${truncate(p.task, 24)} ${(0, time_1.clockTime)(p.updatedAt)}`;
                md.appendMarkdown(`**${p.task}** completed at ${(0, time_1.clockTime)(p.updatedAt)} in ${(0, time_1.formatDuration)(p.elapsed)}${p.detail ? `\n\n${p.detail}` : ''}\n\n`);
            }
        }
        md.appendMarkdown(settings.statusBar.clickAction === 'menu' ? '_Click for actions_' : '_Click to open the dashboard_');
        this.item.tooltip = md;
        this.item.show();
    }
    logsHint() { return this.logsDir || 'the configured logs folder'; }
    dispose() {
        if (this.timer)
            clearInterval(this.timer);
        this.item.dispose();
    }
}
exports.StatusBarManager = StatusBarManager;
function truncate(s, n) {
    s = s || '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
//# sourceMappingURL=statusBar.js.map