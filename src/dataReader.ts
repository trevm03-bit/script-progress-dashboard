// Reads the four JSON files. Tolerant by design: a file is often caught mid-write, so a
// parse failure keeps the LAST GOOD value for that file and reports the problem instead of
// blanking the dashboard. No vscode import, so it is testable with plain Node.
import * as fs from 'fs';
import * as path from 'path';
import { AccessGraph, DashboardData, DeltaSeries, ProgressData, RunRecord } from './types';

export const FILES = {
  progress: 'progress.json',
  history: 'run_history.json',
  deltas: 'deltas.json',
  access: 'access.json',
} as const;

export class DataReader {
  private lastGood: { [k: string]: unknown } = {};
  private lastMtime: { [k: string]: number } = {};

  constructor(public logsDir: string) {}

  setLogsDir(dir: string): void {
    if (dir !== this.logsDir) {
      this.logsDir = dir;
      this.lastGood = {};
      this.lastMtime = {};
    }
  }

  readAll(): DashboardData {
    const readErrors: string[] = [];
    const logsDirExists = fs.existsSync(this.logsDir);
    const progress = this.readJson<ProgressData>(FILES.progress, readErrors);
    const history = this.readJson<RunRecord[]>(FILES.history, readErrors);
    const deltas = this.readJson<DeltaSeries>(FILES.deltas, readErrors);
    const access = this.readJson<AccessGraph>(FILES.access, readErrors);
    return {
      progress: isProgress(progress) ? progress : null,
      history: Array.isArray(history) ? history.filter(isRun) : [],
      deltas: deltas && typeof deltas === 'object' && !Array.isArray(deltas) ? deltas : {},
      access: access && Array.isArray((access as AccessGraph).nodes) ? access : null,
      logsDir: this.logsDir,
      logsDirExists,
      readErrors,
    };
  }

  /** A cheap "did anything change" signal for the poll loop: max mtime across the files. */
  latestMtime(): number {
    let latest = 0;
    for (const name of Object.values(FILES)) {
      try {
        const m = fs.statSync(path.join(this.logsDir, name)).mtimeMs;
        if (m > latest) latest = m;
      } catch { /* missing file is fine */ }
    }
    return latest;
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
    } catch (e) {
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
