"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runbookMarkdown = runbookMarkdown;
const calendar_1 = require("./calendar");
const compliance_1 = require("./compliance");
const time_1 = require("./time");
function runbookMarkdown(data, settings, now) {
    const L = [];
    L.push('# Runbook');
    L.push('');
    L.push(`_Generated ${now.toISOString().slice(0, 16).replace('T', ' ')} by Script Progress Dashboard, from what it has observed._`);
    L.push('');
    L.push('> **Read this before relying on it.** Everything below is derived from runs this tool');
    L.push('> has actually seen. It cannot see steps performed by a person, steps that have never');
    L.push('> run while it was watching, or anything done outside these scripts. Sections marked');
    L.push('> ⚠️ are gaps it knows about; there may be others it does not.');
    L.push('');
    if (!settings.processes.length) {
        L.push('No processes are configured, so there is nothing to describe.');
        L.push('Add `scriptProgress.processCalendar.processes` and run this again.');
        return L.join('\n') + '\n';
    }
    for (const p of settings.processes) {
        L.push(`## ${p.label || p.name}`);
        L.push('');
        L.push(`- **Runs:** ${cadence(p)}`);
        if (p.dependsOn?.length)
            L.push(`- **Cannot start until:** ${p.dependsOn.join(', ')} has run this period`);
        if (p.maxMinutes)
            L.push(`- **Expected to finish within:** ${p.maxMinutes} minutes`);
        const comp = (0, compliance_1.complianceReport)(p, data.history, now, 12);
        if (comp.percent !== null)
            L.push(`- **Recent reliability:** ran in ${comp.met} of the last ${comp.of} period(s) (${comp.percent}%)`);
        L.push('');
        const stepNames = p.subtasks?.length ? p.subtasks : [p.name];
        stepNames.forEach((name, i) => {
            const f = facts(name, data, now);
            L.push(`### Step ${i + 1} — ${name}`);
            L.push('');
            if (!f.runs.length) {
                L.push('⚠️ **This tool has never seen this step run**, so it can say nothing about what it');
                L.push('does. Describe it here by hand, or wire it up with the reporter so the next');
                L.push('generation fills it in.');
                L.push('');
                return;
            }
            const cmd = commandFor(name, settings);
            if (cmd) {
                L.push('```');
                L.push(cmd);
                L.push('```');
                L.push('');
            }
            else
                L.push(`⚠️ No Quick Action is configured for this step, so the exact command is unknown.\n`);
            if (f.typical !== null)
                L.push(`- Usually takes **${(0, time_1.formatDuration)(f.typical)}** (${f.runs.length} run(s) seen)`);
            if (f.reads.length)
                L.push(`- Reads: ${f.reads.map(code).join(', ')}`);
            if (f.writes.length)
                L.push(`- **Writes: ${f.writes.map(code).join(', ')}**`);
            if (!f.reads.length && !f.writes.length)
                L.push('- ⚠️ No inputs or outputs recorded. Add `p.access(...)` calls so this step can describe itself.');
            if (f.artifacts.length)
                L.push(`- Produces: ${f.artifacts.map(code).join(', ')}`);
            const last = f.runs[0];
            if (last?.summary)
                L.push(`- Last run said: _${last.summary}_`);
            L.push('');
            // The gap between one phase and the next is where a human step hides.
            if (i < stepNames.length - 1) {
                L.push(`⚠️ **Between step ${i + 1} and step ${i + 2}:** if anything happens here that is not one of`);
                L.push('these scripts — a file sent to someone, an approval, a wait — write it down here.');
                L.push('This tool cannot see it.');
                L.push('');
            }
        });
    }
    const unwired = settings.processes.filter(p => !(0, calendar_1.runsFor)(p, data.history).length);
    if (unwired.length) {
        L.push('## ⚠️ Not yet observed');
        L.push('');
        L.push('These processes are configured but this tool has never seen them run, so nothing above');
        L.push('describes them: ' + unwired.map(p => p.label || p.name).join(', ') + '.');
        L.push('');
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
function cadence(p) {
    switch (p.frequency) {
        case 'daily': return `daily${p.dueHour !== undefined ? `, expected by ${String(p.dueHour).padStart(2, '0')}:00` : ''}`;
        case 'weekly': return `weekly${p.dayOfWeek ? `, by day ${p.dayOfWeek} of the week` : ''}`;
        default: return `monthly${p.dayOfMonth ? `, by day ${p.dayOfMonth}` : ''}`;
    }
}
function commandFor(task, settings) {
    const b = settings.buttons.find(x => (x.task || '').toLowerCase() === task.toLowerCase())
        ?? settings.buttons.find(x => x.task && task.toLowerCase().startsWith(x.task.toLowerCase()));
    return b?.command ?? null;
}
function facts(name, data, now) {
    const proc = { name, label: name, frequency: 'daily' };
    const runs = data.history
        .filter(r => (0, calendar_1.matchesProcess)(r.task, proc))
        .sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0));
    const durations = runs.filter(r => r.success).map(r => Number(r.elapsed) || 0).filter(n => n > 0);
    const { reads, writes } = accessFor(name, data.access);
    return {
        name, runs,
        typical: durations.length ? median(durations) : null,
        reads, writes,
        artifacts: Array.from(new Set(runs.flatMap(r => r.artifacts ?? []))).slice(0, 8),
    };
}
function accessFor(name, graph) {
    const reads = [], writes = [];
    if (!graph?.edges)
        return { reads, writes };
    const label = (id) => graph.nodes.find(n => n.id === id)?.label ?? id.replace(/^[a-z]+:/, '');
    for (const e of graph.edges) {
        const from = e.from.replace(/^task:/, '');
        if (!from.toLowerCase().startsWith(name.toLowerCase()))
            continue;
        (e.mode === 'write' ? writes : reads).push(label(e.to));
    }
    return { reads: unique(reads), writes: unique(writes) };
}
const unique = (a) => Array.from(new Set(a)).sort();
const code = (s) => '`' + s + '`';
function median(values) {
    const v = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
//# sourceMappingURL=runbook.js.map