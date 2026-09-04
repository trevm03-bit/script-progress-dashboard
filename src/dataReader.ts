// Reads the data files. Tolerant by design: a file is often caught mid-write, so a parse
// failure keeps the LAST GOOD value for that file and reports the problem instead of blanking
// the dashboard. Also reads progress/<slug>.json slot files so concurrent scripts each get a
// card. No vscode import, so it is testable with plain Node.
import * as fs from 'fs';
import * as path from 'path';
import { AccessGraph, DashboardData, DeltaSeries, ImpactSeries, ProgressData, RunOverlay, RunRecord } from './types';
import { parseIso } from './logic/time';

export const FILES = {
  progress: 'progress.json',
  history: 'run_history.json',
  deltas: 'deltas.json',
  impact: 'impact.json',
  access: 'access.json',
} as const;
export const SLOTS_DIR = 'progress';

export class DataReader {
  private lastGood: { [k: string]: unknown } = {};
  /** In-memory facts the extension observed (process exit codes). Never written to disk. */
  overlays: RunOverlay[] = [];

  constructor(public logsDir: string) {}

  setLogsDir(dir: string): void {
    if (dir !== this.logsDir) {
      this.logsDir = dir;
      this.lastGood = {};
      this.overlays = [];
    }
  }

  addOverlay(o: RunOverlay): void {
    this.overlays = [...this.overlays.filter(x => x.task !== o.task), o].slice(-20);
  }

  readAll(): DashboardData {
    const readErrors: string[] = [];
    const logsDirExists = fs.existsSync(this.logsDir);
    const progress = this.readJson<ProgressData>(FILES.progress, readErrors);
    const history = this.readJson<RunRecord[]>(FILES.history, readErrors);
    const deltas = this.readJson<DeltaSeries>(FILES.deltas, readErrors);
    const impact = this.readJson<ImpactSeries>(FILES.impact, readErrors);
    const access = this.readJson<AccessGraph>(FILES.access, readErrors);
    const main = isProgress(progress) ? progress : null;
    const tasks = this.readSlots(readErrors, main);
    // Drop overlays that no longer apply: the task reported a final state since, or no task
    // matches at all (an overlay with nothing to attach to must not live forever).
    this.overlays = this.overlays.filter(o => {
      const t = tasks.find(x => x.task.toLowerCase().startsWith(o.task.toLowerCase()));
      return !!t && t.status === 'running';
    });
    return {
      progress: main,
      tasks,
      history: Array.isArray(history) ? history.filter(isRun) : [],
      deltas: deltas && typeof deltas === 'object' && !Array.isArray(deltas) ? deltas : {},
      impact: impact && typeof impact === 'object' && !Array.isArray(impact) ? impact : {},
      access: access && Array.isArray((access as AccessGraph).nodes) ? access : null,
      overlays: this.overlays,
      logsDir: this.logsDir,
      logsDirExists,
      readErrors,
    };
  }

  /** A cheap "did anything change" signal for the poll loop: max mtime across the files. */
  latestMtime(): number {
    let latest = 0;
    const stat = (p: string) => { try { const m = fs.statSync(p).mtimeMs; if (m > latest) latest = m; } catch { /* missing is fine */ } };
    for (const name of Object.values(FILES)) stat(path.join(this.logsDir, name));
    const slots = path.join(this.logsDir, SLOTS_DIR);
    try { for (const f of fs.readdirSync(slots)) if (f.endsWith('.json')) stat(path.join(slots, f)); } catch { /* no slots */ }
    return latest;
  }

  /**
   * progress/<slug>.json files + the main file, de-duplicated by TASK NAME (one card per task; a
   * task cannot run twice at once in this contract), keeping the newest copy; running first.
   */
  private readSlots(errors: string[], main: ProgressData | null): ProgressData[] {
    const out = new Map<string, ProgressData>();
    const newer = (a: ProgressData, b: ProgressData | undefined) => !b || (parseIso(a.updatedAt)?.getTime() ?? 0) >= (parseIso(b.updatedAt)?.getTime() ?? 0);
    const put = (p: ProgressData) => { const k = p.task.toLowerCase(); if (newer(p, out.get(k))) out.set(k, p); };
    const slots = path.join(this.logsDir, SLOTS_DIR);
    let names: string[] = [];
    try { names = fs.readdirSync(slots).filter(f => f.endsWith('.json')); } catch { names = []; }
    for (const f of names) {
      const p = this.readJson<ProgressData>(`${SLOTS_DIR}/${f}`, errors);
      if (isProgress(p)) put(p);
    }
    if (main) put(main);
    const rank = (p: ProgressData) => (p.status === 'running' ? 0 : 1);
    return [...out.values()].sort((a, b) => rank(a) - rank(b) || (parseIso(b.updatedAt)?.getTime() ?? 0) - (parseIso(a.updatedAt)?.getTime() ?? 0));
  }

  private readJson<T>(name: string, errors: string[]): T | null {
    const file = path.join(this.logsDir, name);
    let text: string;
    try {
      if (!fs.existsSync(file)) {
        delete this.lastGood[name];
        return null;
      }
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      // Locked by the writer for a moment (Windows). Keep what we had.
      return (this.lastGood[name] as T) ?? null;
    }
    try {
      const parsed = JSON.parse(text) as T;
      this.lastGood[name] = parsed;
      return parsed;
    } catch (e) {
      if (text.trim().length === 0) {
        // Zero-length file: the writer truncated and has not written yet. Silent.
        return (this.lastGood[name] as T) ?? null;
      }
      errors.push(`${name}: not valid JSON (${(e as Error).message.split('\n')[0]}) — showing last good copy`);
      return (this.lastGood[name] as T) ?? null;
    }
  }
}

function isProgress(p: unknown): p is ProgressData {
  return !!p && typeof p === 'object' && typeof (p as ProgressData).task === 'string' && typeof (p as ProgressData).status === 'string';
}

function isRun(r: unknown): r is RunRecord {
  return !!r && typeof r === 'object' && typeof (r as RunRecord).task === 'string' && typeof (r as RunRecord).date === 'string';
}
