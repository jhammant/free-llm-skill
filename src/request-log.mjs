import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logPath as defaultLogPath } from './paths.mjs';

export class RequestLog {
  constructor(options = {}) {
    this.path = options.path ?? defaultLogPath(options.env);
    this.redactor = options.redactor ?? { value: (value) => value };
    this.clock = options.clock ?? Date.now;
    this.writeQueue = Promise.resolve();
  }

  async append(entry) {
    const safeEntry = this.redactor.value({
      timestamp: new Date(this.clock()).toISOString(),
      ...entry,
    });
    const write = async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(safeEntry)}\n`, { mode: 0o600 });
    };
    this.writeQueue = this.writeQueue.catch(() => {}).then(write);
    await this.writeQueue;
    return safeEntry;
  }
}

export async function readRequestLog(options = {}) {
  const path = options.path ?? defaultLogPath(options.env);
  const limit = options.limit ?? 20;
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new Error(`Could not read request log ${path}: ${error.message}`, { cause: error });
  }
  const lines = contents.trim().split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines.slice(-limit)) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      entries.push({ timestamp: null, provider: 'unknown', outcome: 'malformed-log-entry' });
    }
  }
  return entries;
}
