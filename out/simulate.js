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
exports.simulateRun = simulateRun;
// "Simulate a Demo Run": the extension itself plays a short job through the SAME file contract
// the reporters use, so an install can be verified with no Python or Node at all. It refuses to
// start while a real task is running, and writes only into the configured logs folder.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const time_1 = require("./logic/time");
const STEPS = [
    ['Reading input file', 'file', 'input/orders.csv', 'read'],
    ['Validating rows', null, '', 'read'],
    ['Looking up customers', 'table', 'crm.customers', 'read'],
    ['Joining products', 'table', 'catalog.products', 'read'],
    ['Calculating totals', null, '', 'read'],
    ['Writing warehouse table', 'table', 'sales.orders_monthly', 'write'],
    ['Posting summary', 'api', 'Reporting service', 'write'],
];
function iso(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function readJson(file, def) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    catch {
        return def;
    }
}
function writeJson(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function simulateRun(logsDir, current, staleMinutes, mode = 'ok') {
    const now = new Date();
    const busy = current.tasks.find(t => (0, time_1.taskState)(t, staleMinutes, now, current.overlays) === 'running');
    if (busy) {
        void vscode.window.showWarningMessage(`Script Progress: "${busy.task}" is running — the demo will not write over a real run.`);
        return;
    }
    fs.mkdirSync(path.join(logsDir, 'progress'), { recursive: true });
    const task = 'Demo Pipeline (simulated)';
    const runId = `${iso().replace(/[-:T]/g, '').slice(0, 15)}-demo`;
    const startedAt = iso();
    const start = Date.now();
    const warnings = [];
    const log = [];
    const accessed = [];
    const metrics = {};
    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const write = (status, step, label, detail, substep) => {
        const data = {
            task, status, step, totalSteps: STEPS.length, label, detail, substep,
            elapsed: Math.round((Date.now() - start) / 100) / 10, eta: status === 'running' ? Math.max(0, Math.round((STEPS.length - step) * 0.9)) : null,
            warnings: warnings.slice(-10), log: log.slice(-20), metrics, artifacts: [], accessed, runId, startedAt, updatedAt: iso(),
        };
        writeJson(path.join(logsDir, 'progress.json'), data);
        writeJson(path.join(logsDir, 'progress', `${(0, time_1.slug)(task)}.json`), data);
    };
    const access = (kind, name, mode) => {
        const file = path.join(logsDir, 'access.json');
        const g = readJson(file, { nodes: [], edges: [] });
        const nodes = new Map((g.nodes || []).map(n => [n.id, n]));
        const tid = `task:${task}`, rid = `${kind}:${name}`, t = iso();
        nodes.set(tid, { id: tid, type: 'task', label: task, lastSeen: t });
        nodes.set(rid, { id: rid, type: kind, label: name, lastSeen: t });
        const edges = g.edges || [];
        const e = edges.find(x => x.from === tid && x.to === rid && x.mode === mode);
        if (e) {
            e.count++;
            e.lastSeen = t;
        }
        else
            edges.push({ from: tid, to: rid, mode, count: 1, lastSeen: t });
        writeJson(file, { nodes: [...nodes.values()], edges });
        if (!accessed.includes(rid))
            accessed.push(rid);
    };
    write('running', 0, 'Starting', '', null);
    log.push({ time: iso(), msg: 'simulated by the extension — no script involved' });
    for (let i = 0; i < STEPS.length; i++) {
        const [label, kind, name, mode] = STEPS[i];
        write('running', i + 1, label, '', null);
        if (kind)
            access(kind, name, mode);
        for (let f = 1; f <= 4; f++) {
            await sleep(180);
            write('running', i + 1, label, '', f / 4);
        }
        const rows = rnd(1000, 5000);
        write('running', i + 1, label, `${rows.toLocaleString('en-US')} rows`, null);
        if (i === 2)
            warnings.push({ time: iso(), msg: `${rnd(3, 40)} rows had no customer id` });
        if (i === 4) {
            warnings.push({ time: iso(), msg: 'Totals differ from prior month by more than 20%' });
            metrics.rows_loaded = rnd(3800, 4200);
        }
        log.push({ time: iso(), msg: `${label.toLowerCase()} done` });
        await sleep(160);
    }
    metrics.total_value = `$${(10 + Math.random() * 10).toFixed(1)}M`;
    const deltasFile = path.join(logsDir, 'deltas.json');
    const deltas = readJson(deltasFile, {});
    (deltas.rows_loaded = deltas.rows_loaded || []).push({ date: iso(), value: Number(metrics.rows_loaded), task });
    (deltas.reconciliation_delta = deltas.reconciliation_delta || []).push({ date: iso(), value: Math.round((Math.random() - 0.5) * 100) / 100, task });
    for (const k of Object.keys(deltas))
        deltas[k] = deltas[k].slice(-50);
    writeJson(deltasFile, deltas);
    const ok = mode === 'ok';
    const summary = ok ? `INSERT: ${Number(metrics.rows_loaded).toLocaleString('en-US')} rows | total ${metrics.total_value}` : 'Row count mismatch: expected 4,013 got 3,977';
    write(ok ? 'complete' : 'failed', STEPS.length, ok ? 'Complete' : 'FAILED', summary, null);
    const histFile = path.join(logsDir, 'run_history.json');
    const hist = readJson(histFile, []);
    hist.push({ task, date: iso(), success: ok, elapsed: Math.round((Date.now() - start) / 100) / 10, summary, warnings: warnings.length, runId, startedAt, metrics, warningItems: warnings, accessed, artifacts: [] });
    writeJson(histFile, hist.slice(-100));
}
//# sourceMappingURL=simulate.js.map