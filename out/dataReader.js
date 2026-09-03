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
exports.DataReader = exports.FILES = void 0;
// Reads the four JSON files. Tolerant by design: a file is often caught mid-write, so a
// parse failure keeps the LAST GOOD value for that file and reports the problem instead of
// blanking the dashboard. No vscode import, so it is testable with plain Node.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.FILES = {
    progress: 'progress.json',
    history: 'run_history.json',
    deltas: 'deltas.json',
    access: 'access.json',
};
class DataReader {
    constructor(logsDir) {
        this.logsDir = logsDir;
        this.lastGood = {};
        this.lastMtime = {};
    }
    setLogsDir(dir) {
        if (dir !== this.logsDir) {
            this.logsDir = dir;
            this.lastGood = {};
            this.lastMtime = {};
        }
    }
    readAll() {
        const readErrors = [];
        const logsDirExists = fs.existsSync(this.logsDir);
        const progress = this.readJson(exports.FILES.progress, readErrors);
        const history = this.readJson(exports.FILES.history, readErrors);
        const deltas = this.readJson(exports.FILES.deltas, readErrors);
        const access = this.readJson(exports.FILES.access, readErrors);
        return {
            progress: isProgress(progress) ? progress : null,
            history: Array.isArray(history) ? history.filter(isRun) : [],
            deltas: deltas && typeof deltas === 'object' && !Array.isArray(deltas) ? deltas : {},
            access: access && Array.isArray(access.nodes) ? access : null,
            logsDir: this.logsDir,
            logsDirExists,
            readErrors,
        };
    }
    /** A cheap "did anything change" signal for the poll loop: max mtime across the files. */
    latestMtime() {
        let latest = 0;
        for (const name of Object.values(exports.FILES)) {
            try {
                const m = fs.statSync(path.join(this.logsDir, name)).mtimeMs;
                if (m > latest)
                    latest = m;
            }
            catch { /* missing file is fine */ }
        }
        return latest;
    }
    readJson(name, errors) {
        const file = path.join(this.logsDir, name);
        let text;
        try {
            if (!fs.existsSync(file)) {
                delete this.lastGood[name];
                return null;
            }
            text = fs.readFileSync(file, 'utf-8');
        }
        catch (e) {
            // Locked by the writer for a moment (Windows). Keep what we had.
            return this.lastGood[name] ?? null;
        }
        try {
            const parsed = JSON.parse(text);
            this.lastGood[name] = parsed;
            return parsed;
        }
        catch (e) {
            if (text.trim().length === 0) {
                // Zero-length file: the writer truncated and has not written yet. Silent.
                return this.lastGood[name] ?? null;
            }
            errors.push(`${name}: not valid JSON (${e.message.split('\n')[0]}) — showing last good copy`);
            return this.lastGood[name] ?? null;
        }
    }
}
exports.DataReader = DataReader;
function isProgress(p) {
    return !!p && typeof p === 'object' && typeof p.task === 'string' && typeof p.status === 'string';
}
function isRun(r) {
    return !!r && typeof r === 'object' && typeof r.task === 'string' && typeof r.date === 'string';
}
//# sourceMappingURL=dataReader.js.map