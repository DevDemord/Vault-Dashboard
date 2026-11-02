import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { ActivityLogEntry, NoteSummary, TagCount, VaultFolderSize } from '../types';
import { buildHeatmap, formatDay, intensityClass } from './activityHeatmap';

const HEATMAP_DAYS = 90;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StatsView({ notes, tags }: { notes: NoteSummary[]; tags: TagCount[] }) {
  const [sizes, setSizes] = useState<VaultFolderSize[] | null>(null);
  useEffect(() => {
    api.vaultSize().then(setSizes).catch(() => setSizes([]));
  }, []);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[] | null>(null);
  useEffect(() => {
    api.activityLog().then(setActivityLog).catch(() => setActivityLog([]));
  }, []);
  const totalBytes = useMemo(() => (sizes ?? []).reduce((sum, s) => sum + s.bytes, 0), [sizes]);
  const maxFolderBytes = sizes?.[0]?.bytes ?? 1;

  const weeks = useMemo(() => buildHeatmap(notes, HEATMAP_DAYS), [notes]);
  const maxDayCount = useMemo(
    () => weeks.flat().reduce((m, d) => Math.max(m, d?.count ?? 0), 0),
    [weeks],
  );

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      const top = note.folder ? note.folder.split('/')[0] : '(root)';
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return [...counts.entries()].map(([folder, count]) => ({ folder, count })).sort((a, b) => b.count - a.count);
  }, [notes]);
  const maxFolderCount = folderCounts[0]?.count ?? 1;

  const maxTagCount = tags.reduce((m, t) => Math.max(m, t.count), 1);
  const tagFontSize = (count: number) => 0.75 + (count / maxTagCount) * 1.1;

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-slate-100">Vault activity</h1>
      <div className="mb-6 text-sm text-slate-500">
        Notes per folder, tag cloud, and an edit heatmap keyed by last-modified date — the vault has no edit
        history, so each note counts once, on the day it was most recently saved.
      </div>

      <section className="mb-8">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Edit activity (last 90 days)</div>
        <div className="scroll-pane overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
          <div className="flex gap-[3px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((day, di) =>
                  day ? (
                    <div
                      key={di}
                      title={`${formatDay(day.date)}: ${day.count} note${day.count === 1 ? '' : 's'} edited`}
                      className={`h-[11px] w-[11px] rounded-sm ${intensityClass(day.count, maxDayCount)}`}
                    />
                  ) : (
                    <div key={di} className="h-[11px] w-[11px]" />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Notes per folder</div>
        <div className="space-y-1.5 rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
          {folderCounts.map(({ folder, count }) => (
            <div key={folder} className="flex items-center gap-2 text-sm">
              <div className="w-36 flex-shrink-0 truncate text-slate-400">{folder}</div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                  style={{ width: `${(count / maxFolderCount) * 100}%` }}
                />
              </div>
              <div className="w-8 flex-shrink-0 text-right text-slate-500">{count}</div>
            </div>
          ))}
          {folderCounts.length === 0 && <div className="text-sm text-slate-500">No notes found in the vault yet.</div>}
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
          <span>Size on disk</span>
          {sizes && sizes.length > 0 && <span className="text-slate-600">{formatSize(totalBytes)} total</span>}
        </div>
        <div className="space-y-1.5 rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
          {(sizes ?? []).map(({ folder, bytes }) => (
            <div key={folder} className="flex items-center gap-2 text-sm">
              <div className="w-36 flex-shrink-0 truncate text-slate-400">{folder}</div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500"
                  style={{ width: `${(bytes / maxFolderBytes) * 100}%` }}
                />
              </div>
              <div className="w-16 flex-shrink-0 text-right text-slate-500">{formatSize(bytes)}</div>
            </div>
          ))}
          {sizes === null && <div className="text-sm text-slate-500">Loading…</div>}
          {sizes?.length === 0 && <div className="text-sm text-slate-500">Nothing on disk yet.</div>}
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Tag cloud</div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
          {tags.map((t) => (
            <span
              key={t.tag}
              title={`${t.count} note${t.count === 1 ? '' : 's'}`}
              style={{ fontSize: `${tagFontSize(t.count)}rem` }}
              className="leading-none text-violet-300/90"
            >
              #{t.tag}
            </span>
          ))}
          {tags.length === 0 && <div className="text-sm text-slate-500">No tags yet.</div>}
        </div>
      </section>

      <section>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Claude activity log</div>
        <p className="mb-2 text-xs text-slate-500">
          What Claude's shipped to this dashboard itself, newest first — moved here from the daily note so
          it doesn't crowd out Today's Note.
        </p>
        <div className="scroll-pane max-h-[40vh] space-y-3 overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
          {(activityLog ?? []).map(({ date, lines }) => (
            <div key={date}>
              <div className="mb-1 text-xs font-medium text-slate-400">{date}</div>
              <ul className="space-y-1">
                {lines.map((line, i) => (
                  <li key={i} className="pl-3 text-sm text-slate-300" style={{ textIndent: '-0.75rem' }}>
                    • {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {activityLog !== null && activityLog.length === 0 && (
            <div className="text-sm text-slate-500">Nothing logged yet.</div>
          )}
          {activityLog === null && <div className="text-sm text-slate-500">Loading…</div>}
        </div>
      </section>
    </div>
  );
}
