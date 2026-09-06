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
exports.DataReader = exports.SLOTS_DIR = exports.FILES = void 0;
// Reads the data files. Tolerant by design: a file is often caught mid-write, so a parse
// failure keeps the LAST GOOD value for that file and reports the problem instead of blanking
// the dashboard. Also reads progress/<slug>.json slot files so concurrent scripts each get a
// card. No vscode import, so it is testable with plain Node.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const time_1 = require("./logic/time");
exports.FILES = {
    progress: 'progress.json',
    history: 'run_history.json',
    deltas: 'deltas.json',
    impact: 'impact.json',
    access: 'access.json',
};
exports.SLOTS_DIR = 'progress';
class DataReader {
    constructor(logsDir) {
        this.logsDir = logsDir;
        this.lastGood = {};
        /** When each file was first seen zero-length, so a truncation that never finishes gets reported. */
        this.emptySince = {};
        /** In-memory facts the extension observed (process exit codes). Never written to disk. */
        this.overlays = [];
        /** The slots as of the last read, so an incoming exit can be stamped with the run it ended. */
        this.lastTasks = [];
    }
    setLogsDir(dir) {
        if (dir !== this.logsDir) {
            this.logsDir = dir;
            this.lastGood = {};
            this.emptySince = {};
            this.overlays = [];
        }
    }
    addOverlay(o) {
        // 🔴 Stamp the exit with the run it actually ended. The terminal hook knows a task name and
        // an exit code and nothing else, so without this the only way to tell whose exit it was
        // was the clock - and exitOverlayFor allowed a 1 s grace, while the reporter writes
        // startedAt truncated to the second (another 999 ms). In that ~2 s window a fresh run
        // showed "Exited (137)" the moment it started, fired a false error toast, and stopped
        // ticking because taskState was no longer 'running'.
        const current = this.lastTasks.find(x => (x.task || '').toLowerCase() === (o.task || '').toLowerCase());
        o = { ...o, runId: o.runId ?? current?.runId, startedAt: o.startedAt ?? current?.startedAt };
        // Case-INSENSITIVE, to match how overlays are read back. An exact compare here let "Nightly",
        // "nightly" and "Nightly " pile up as three separate exits for one script, and the reader
        // then served whichever happened to be first — measured as a months-old exit code 137 being
        // reported for a process that had just ended cleanly.
        this.overlays = [...this.overlays.filter(x => x.task.toLowerCase() !== o.task.toLowerCase()), o].slice(-20);
    }
    readAll() {
        const readErrors = [];
        const logsDirExists = fs.existsSync(this.logsDir);
        const progress = this.readJson(exports.FILES.progress, readErrors);
        const history = this.readJson(exports.FILES.history, readErrors);
        const deltas = this.readJson(exports.FILES.deltas, readErrors);
        const impact = this.readJson(exports.FILES.impact, readErrors);
        const access = this.readJson(exports.FILES.access, readErrors);
        const main = isProgress(progress) ? normaliseProgress(progress) : null;
        const tasks = this.readSlots(readErrors, main);
        // Drop overlays that no longer apply: the task reported a final state since, or no task
        // matches at all (an overlay with nothing to attach to must not live forever).
        this.lastTasks = tasks;
        this.overlays = this.overlays.filter(o => {
            const t = tasks.find(x => x.task.toLowerCase() === o.task.toLowerCase());
            if (!t || t.status !== 'running')
                return false;
            // A different run of the same name is a different run. This is the case the timestamp
            // window could never separate: the previous run's exit must not survive into it.
            return !(o.runId && t.runId && o.runId !== t.runId);
        });
        return {
            progress: main,
            tasks,
            history: Array.isArray(history) ? history.filter(isRun).map(normaliseRun) : [],
            // Series files are normalised POINT BY POINT, not just at the top level. A single null or
            // malformed entry — a hand edit, a half-written file, an import from elsewhere — used to
            // throw inside a renderer, and a renderer that throws blanks the whole dashboard. The one
            // bad point is dropped; everything around it still draws.
            deltas: normalizeSeries(deltas, isDeltaPoint),
            impact: normalizeSeries(impact, isImpactPoint),
            access: access && Array.isArray(access.nodes) ? access : null,
            overlays: this.overlays,
            logsDir: this.logsDir,
            logsDirExists,
            readErrors,
        };
    }
    /** A cheap "did anything change" signal for the poll loop: max mtime across the files. */
    latestMtime() {
        let latest = 0;
        const stat = (p) => { try {
            const m = fs.statSync(p).mtimeMs;
            if (m > latest)
                latest = m;
        }
        catch { /* missing is fine */ } };
        for (const name of Object.values(exports.FILES))
            stat(path.join(this.logsDir, name));
        const slots = path.join(this.logsDir, exports.SLOTS_DIR);
        try {
            for (const f of fs.readdirSync(slots))
                if (f.endsWith('.json'))
                    stat(path.join(slots, f));
        }
        catch { /* no slots */ }
        return latest;
    }
    /**
     * progress/<slug>.json files + the main file, de-duplicated by TASK NAME (one card per task; a
     * task cannot run twice at once in this contract), keeping the newest copy; running first.
     */
    readSlots(errors, main) {
        const out = new Map();
        const newer = (a, b) => !b || ((0, time_1.parseIso)(a.updatedAt)?.getTime() ?? 0) >= ((0, time_1.parseIso)(b.updatedAt)?.getTime() ?? 0);
        const put = (p) => { const k = p.task.toLowerCase(); if (newer(p, out.get(k)))
            out.set(k, p); };
        const slots = path.join(this.logsDir, exports.SLOTS_DIR);
        let names = [];
        try {
            names = fs.readdirSync(slots).filter(f => f.endsWith('.json'));
        }
        catch {
            names = [];
        }
        for (const f of names) {
            const p = this.readJson(`${exports.SLOTS_DIR}/${f}`, errors);
            if (isProgress(p))
                put(normaliseProgress(p));
        }
        if (main)
            put(main);
        const rank = (p) => (p.status === 'running' ? 0 : 1);
        return [...out.values()].sort((a, b) => rank(a) - rank(b) || ((0, time_1.parseIso)(b.updatedAt)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.updatedAt)?.getTime() ?? 0));
    }
    readJson(name, errors) {
        const file = path.join(this.logsDir, name);
        let text;
        try {
            if (!fs.existsSync(file)) {
                delete this.lastGood[name];
                delete this.emptySince[name];
                return null;
            }
            text = fs.readFileSync(file, 'utf-8');
        }
        catch {
            // Locked by the writer for a moment (Windows). Keep what we had.
            return this.lastGood[name] ?? null;
        }
        // Strip a UTF-8 byte-order mark. JSON.parse rejects one outright, so a file produced by
        // anything that writes a BOM by default — PowerShell's Set-Content -Encoding utf8, Notepad,
        // several Windows tools — would be refused on EVERY refresh, for the life of the file, with
        // only a generic parse error to go on. Our own reporter never writes one; other producers do,
        // and the JSON files are explicitly an open contract.
        if (text.charCodeAt(0) === 0xFEFF)
            text = text.slice(1);
        try {
            const parsed = JSON.parse(text);
            this.lastGood[name] = parsed;
            delete this.emptySince[name];
            return parsed;
        }
        catch (e) {
            if (text.trim().length === 0) {
                // Zero-length: normally the writer has truncated and is about to write, which is not
                // worth a message. But a writer that truncated and then DIED leaves this forever, and
                // staying silent means a card frozen at "running" with nothing anywhere to explain it.
                // Say so once the file has been empty for longer than any real write takes.
                const first = this.emptySince[name] ?? (this.emptySince[name] = Date.now());
                if (Date.now() - first > 30000) {
                    errors.push(`${name}: the file is empty — showing the last good copy (the script that writes it may have stopped mid-write)`);
                }
                return this.lastGood[name] ?? null;
            }
            errors.push(`${name}: not valid JSON (${e.message.split('\n')[0]}) — showing last good copy`);
            return this.lastGood[name] ?? null;
        }
    }
}
exports.DataReader = DataReader;
/**
 * Members of an array that are usable objects, and nothing else.
 *
 * 🔴 isRun() checks that `task` and `date` are strings; isProgress() checks `task` and
 * `status`. Every ARRAY inside them - warningItems, accessed, artifacts, and a slot's warnings
 * and log - reached the renderers unexamined, and these files are an explicitly open contract
 * that other producers write. One null member raised a TypeError inside renderSections, which
 * nothing on the path catches, so the webview kept showing its last-good HTML for ever with no
 * error anywhere: a dashboard that has silently stopped moving.
 */
const objectsIn = (v) => (Array.isArray(v) ? v.filter((x) => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const stringsIn = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
/** A history row whose arrays are safe to iterate. */
function normaliseRun(r) {
    return {
        ...r,
        warningItems: objectsIn(r.warningItems),
        accessed: stringsIn(r.accessed),
        artifacts: stringsIn(r.artifacts),
    };
}
/** A slot whose arrays are safe to iterate. */
function normaliseProgress(p) {
    return {
        ...p,
        warnings: objectsIn(p.warnings),
        log: objectsIn(p.log),
        accessed: stringsIn(p.accessed),
        artifacts: stringsIn(p.artifacts),
    };
}
function isProgress(p) {
    return !!p && typeof p === 'object' && typeof p.task === 'string' && typeof p.status === 'string';
}
/** Keep the shape { name: [point, ...] }, dropping anything that is not a usable point. */
function normalizeSeries(value, ok) {
    const out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return out;
    for (const [name, points] of Object.entries(value)) {
        if (!Array.isArray(points))
            continue;
        const kept = points.filter(ok);
        // Keep the key even when nothing survived. Dropping it entirely made the section say
        // "nothing recorded yet" about a file that exists and names the metric — the user has no way
        // to tell a missing series from a rejected one.
        if (kept.length || points.length)
            out[name] = kept;
    }
    return out;
}
function isDeltaPoint(p) {
    return !!p && typeof p === 'object'
        && typeof p.date === 'string'
        && typeof p.value === 'number'
        && isFinite(p.value);
}
function isImpactPoint(p) {
    return !!p && typeof p === 'object'
        && typeof p.date === 'string'
        && typeof p.value === 'number'
        && isFinite(p.value);
}
function isRun(r) {
    return !!r && typeof r === 'object' && typeof r.task === 'string' && typeof r.date === 'string';
}
//# sourceMappingURL=dataReader.js.map