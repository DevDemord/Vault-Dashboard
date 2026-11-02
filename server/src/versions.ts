import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR ?? '/app/data';
const VERSIONS_DIR = path.join(DATA_DIR, 'versions');

/** Snapshots within this long of the previous one for the same note are skipped — autosave (the
 * Today note debounce-saves every ~1.2s while typing) would otherwise produce dozens of near-
 * identical snapshots per minute instead of a meaningful history. */
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_SNAPSHOTS_PER_NOTE = 20;

interface Snapshot {
  ts: number;
  content: string;
}

function keyFor(relPath: string): string {
  return Buffer.from(relPath, 'utf8').toString('base64url') + '.json';
}

async function readSnapshots(relPath: string): Promise<Snapshot[]> {
  try {
    const raw = await fs.readFile(path.join(VERSIONS_DIR, keyFor(relPath)), 'utf8');
    return JSON.parse(raw) as Snapshot[];
  } catch {
    return [];
  }
}

async function writeSnapshots(relPath: string, snapshots: Snapshot[]): Promise<void> {
  await fs.mkdir(VERSIONS_DIR, { recursive: true });
  await fs.writeFile(path.join(VERSIONS_DIR, keyFor(relPath)), JSON.stringify(snapshots));
}

// Per-note write queues (same reasoning as settings.ts's single queue) — keyed by note since
// snapshots for different notes never conflict with each other.
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = (queues.get(key) ?? Promise.resolve()) as Promise<unknown>;
  const next = prev.catch(() => undefined).then(fn);
  queues.set(key, next);
  return next;
}

/** Called just before a note is overwritten, with the content it *currently* holds on disk (i.e.
 * the version about to be lost) — snapshots that, throttled to at most one per `MIN_INTERVAL_MS`. */
export function maybeSnapshot(relPath: string, currentContent: string): Promise<void> {
  return enqueue(relPath, async () => {
    const snapshots = await readSnapshots(relPath);
    const last = snapshots[snapshots.length - 1];
    if (last && Date.now() - last.ts < MIN_INTERVAL_MS) return;
    snapshots.push({ ts: Date.now(), content: currentContent });
    if (snapshots.length > MAX_SNAPSHOTS_PER_NOTE) snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS_PER_NOTE);
    await writeSnapshots(relPath, snapshots);
  });
}

export async function listSnapshots(relPath: string): Promise<{ ts: number }[]> {
  const snapshots = await readSnapshots(relPath);
  return snapshots.map((s) => ({ ts: s.ts })).sort((a, b) => b.ts - a.ts);
}

export async function getSnapshotContent(relPath: string, ts: number): Promise<string | null> {
  const snapshots = await readSnapshots(relPath);
  return snapshots.find((s) => s.ts === ts)?.content ?? null;
}
