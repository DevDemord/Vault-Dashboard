import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { diffLines } from './diffLines';
import type { NoteDetail, VersionMeta } from '../types';

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Lists a note's saved snapshots (throttled server-side to at most one every 10 minutes — see
 * `server/src/versions.ts`), diffs a chosen one against the note's current raw content, and can
 * restore it. Restoring just re-uses the existing raw-save endpoint (`PUT /api/raw/*`) rather than
 * adding a dedicated restore endpoint — there's nothing a restore does that a save doesn't.
 */
export function VersionHistoryModal({
  relPath,
  currentContent,
  onClose,
  onRestored,
}: {
  relPath: string;
  currentContent: string;
  onClose: () => void;
  onRestored: (updated: NoteDetail) => void;
}) {
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [selectedTs, setSelectedTs] = useState<number | null>(null);
  const [snapshotContent, setSnapshotContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    api
      .listVersions(relPath)
      .then(setVersions)
      .catch(() => setError('Could not load version history.'));
  }, [relPath]);

  useEffect(() => {
    if (selectedTs === null) return;
    setSnapshotContent(null);
    api
      .getVersionContent(relPath, selectedTs)
      .then(setSnapshotContent)
      .catch(() => setError('Could not load that snapshot.'));
  }, [relPath, selectedTs]);

  const restore = async () => {
    if (snapshotContent === null) return;
    if (!confirm('Replace the current content with this version? The current content becomes a new snapshot first, so this is reversible.')) return;
    setRestoring(true);
    try {
      const updated = await api.updateRaw(relPath, snapshotContent);
      onRestored(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not restore this version.');
    } finally {
      setRestoring(false);
    }
  };

  const diff = snapshotContent !== null ? diffLines(snapshotContent, currentContent) : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="font-display text-lg font-semibold text-slate-100">Version history</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="scroll-pane w-48 flex-shrink-0 overflow-y-auto border-r border-slate-800 p-2">
            {versions === null && <div className="px-2 py-2 text-xs text-slate-500">Loading…</div>}
            {versions?.length === 0 && (
              <div className="px-2 py-2 text-xs text-slate-500">
                No snapshots yet — one is kept at most every 10 minutes as you edit.
              </div>
            )}
            {versions?.map((v) => (
              <button
                key={v.ts}
                onClick={() => setSelectedTs(v.ts)}
                className={`block w-full rounded px-2 py-1.5 text-left text-xs transition ${
                  selectedTs === v.ts ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:bg-slate-800/60'
                }`}
              >
                {formatTs(v.ts)}
              </button>
            ))}
          </div>

          <div className="scroll-pane min-h-0 flex-1 overflow-y-auto p-3">
            {selectedTs === null && (
              <div className="text-sm text-slate-500">Pick a snapshot on the left to see what changed since.</div>
            )}
            {selectedTs !== null && !diff && <div className="text-sm text-slate-500">Loading…</div>}
            {diff?.tooLarge && <div className="text-sm text-slate-500">This note is too large to diff.</div>}
            {diff && !diff.tooLarge && (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {diff.lines.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.type === 'add'
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : line.type === 'remove'
                          ? 'bg-red-500/10 text-red-300'
                          : 'text-slate-500'
                    }
                  >
                    {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
                    {line.text}
                  </div>
                ))}
              </pre>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-800 px-4 py-3">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
            Close
          </button>
          <button
            onClick={restore}
            disabled={selectedTs === null || restoring}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {restoring ? 'Restoring…' : 'Restore this version'}
          </button>
        </div>
      </div>
    </div>
  );
}
