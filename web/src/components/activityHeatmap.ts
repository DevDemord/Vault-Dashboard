import type { NoteSummary } from '../types';

export interface DayBucket {
  date: string;
  count: number;
}

/** One bucket per day for the last `days` days, keyed by last-edit date. The vault has no edit-
 * history log — only each note's current mtime — so this counts a note once, on its most recent
 * edit day, same approximation GitHub's own heatmap would show if it only had `git log -1` per
 * file. Shared by the full Activity page's calendar grid and the home page's stat-bar strip. */
export function buildDayBuckets(notes: NoteSummary[], days: number): DayBucket[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const key = new Date(note.mtime).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const bucket: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    bucket.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return bucket;
}

/** Chunks `buildDayBuckets`'s flat list into Sun..Sat columns for the calendar-style grid on the
 * full Activity page. */
export function buildHeatmap(notes: NoteSummary[], days: number): (DayBucket | null)[][] {
  const bucket = buildDayBuckets(notes, days);

  // Pad the front so the first column's weekday lines up with the rest (Sun..Sat columns).
  const startDow = new Date(bucket[0].date + 'T00:00:00Z').getUTCDay();
  const padded: (DayBucket | null)[] = [...Array(startDow).fill(null), ...bucket];

  const weeks: (DayBucket | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return weeks;
}

export function intensityClass(count: number, max: number): string {
  if (count === 0) return 'bg-slate-800/60';
  if (max <= 0) return 'bg-slate-800/60';
  const ratio = count / max;
  if (ratio <= 0.25) return 'bg-violet-900/70';
  if (ratio <= 0.5) return 'bg-violet-700';
  if (ratio <= 0.75) return 'bg-violet-500';
  return 'bg-fuchsia-400';
}

export function formatDay(date: string): string {
  return new Date(date + 'T00:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
