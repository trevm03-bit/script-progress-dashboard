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
// the elapsed time moves even between writes.
const vscode = __importStar(require("vscode"));
const time_1 = require("./logic/time");
class StatusBarManager {
    constructor() {
        this.data = null;
        this.settings = null;
        this.item = vscode.window.createStatusBarItem('scriptProgress.status', vscode.StatusBarAlignment.Left, 100);
        this.item.name = 'Script Progress';
        this.item.command = 'scriptProgress.openPanel';
    }
    update(data, settings) {
        this.data = data;
        this.settings = settings;
        this.render();
        // Tick only while something is running; otherwise nothing on the bar changes by itself.
        const running = data.progress && (0, time_1.taskState)(data.progress, settings.staleRunningMinutes, new Date()) === 'running';
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
        if (!data || !settings || !settings.statusBarEnabled) {
            this.item.hide();
            return;
        }
        const p = data.progress;
        if (!p) {
            this.item.hide();
            return;
        }
        const now = new Date();
        const state = (0, time_1.taskState)(p, settings.staleRunningMinutes, now);
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${p.task}**\n\n`);
        this.item.backgroundColor = undefined;
        switch (state) {
            case 'running': {
                const step = p.totalSteps > 0 ? `${p.step}/${p.totalSteps} ` : '';
                const eta = (0, time_1.liveEta)(p, now);
                this.item.text = `$(sync~spin) ${step}${truncate(p.label, 28)} · ${(0, time_1.formatDuration)((0, time_1.liveElapsed)(p, now))}`;
                md.appendMarkdown(`${p.label}${p.detail ? ` — ${p.detail}` : ''}\n\nElapsed ${(0, time_1.formatDuration)((0, time_1.liveElapsed)(p, now))}${eta !== null ? ` · ~${(0, time_1.formatDuration)(eta)} left` : ''}`);
                if (p.warnings?.length)
                    md.appendMarkdown(`\n\n$(warning) ${p.warnings.length} warning(s)`);
                break;
            }
            case 'stalled': {
                this.item.text = `$(warning) Stalled ${Math.round((0, time_1.minutesSinceUpdate)(p, now))}m · ${truncate(p.task, 24)}`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                md.appendMarkdown(`Still marked running but not updated for ${Math.round((0, time_1.minutesSinceUpdate)(p, now))} minutes.\n\nLast step: ${p.label}`);
                break;
            }
            case 'complete': {
                this.item.text = `$(check) ${truncate(p.task, 24)} ${(0, time_1.clockTime)(p.updatedAt)}`;
                md.appendMarkdown(`Completed at ${(0, time_1.clockTime)(p.updatedAt)} in ${(0, time_1.formatDuration)(p.elapsed)}${p.detail ? `\n\n${p.detail}` : ''}`);
                break;
            }
            case 'failed': {
                this.item.text = `$(error) FAILED ${truncate(p.task, 22)}`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                md.appendMarkdown(`Failed at ${(0, time_1.clockTime)(p.updatedAt)} after ${(0, time_1.formatDuration)(p.elapsed)}${p.detail ? `\n\n${p.detail}` : ''}`);
                break;
            }
            default:
                this.item.hide();
                return;
        }
        md.appendMarkdown('\n\n_Click to open the dashboard_');
        md.supportThemeIcons = true;
        this.item.tooltip = md;
        this.item.show();
    }
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