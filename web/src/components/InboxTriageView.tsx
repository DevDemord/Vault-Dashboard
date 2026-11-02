import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { CreateOptions, NoteSummary } from '../types';

const NEW_FOLDER_SENTINEL = '__new__';

export function InboxTriageView({
  items,
  onNavigate,
  onChanged,
}: {
  items: NoteSummary[];
  onNavigate: (relPath: string) => void;
  onChanged: () => void;
}) {
  const [options, setOptions] = useState<CreateOptions | null>(null);
  const [movingPath, setMovingPath] = useState<string | null>(null);
  const [moveFolder, setMoveFolder] = useState('');
  const [moveNewFolder, setMoveNewFolder] = useState('');
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.createOptions().then(setOptions);
  }, []);

  const startMove = (relPath: string) => {
    setMovingPath(relPath);
    setMoveFolder(options?.resourceFolders[0] ?? NEW_FOLDER_SENTINEL);
    setMoveNewFolder('');
    setError(null);
  };

  const confirmMove = async (relPath: string) => {
    const folder = moveFolder === NEW_FOLDER_SENTINEL ? moveNewFolder.trim() : moveFolder;
    if (!folder) return setError('Pick or name a folder.');
    setBusyPath(relPath);
    setError(null);
    try {
      await api.moveToResourceFolder(relPath, folder);
      setMovingPath(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not move this note.');
    } finally {
      setBusyPath(null);
    }
  };

  const archive = async (relPath: string) => {
    setBusyPath(relPath);
    setError(null);
    try {
      await api.archiveNote(relPath);
      onChanged();
    } catch {
      setError('Could not archive this note.');
    } finally {
      setBusyPath(null);
    }
  };

  const addTag = async (note: NoteSummary) => {
    const draft = (tagDrafts[note.relPath] ?? '').trim().toLowerCase();
    if (!draft || note.tags.includes(draft)) return;
    setBusyPath(note.relPath);
    setError(null);
    try {
      await api.setTags(note.relPath, [...note.tags, draft]);
      setTagDrafts((prev) => ({ ...prev, [note.relPath]: '' }));
      onChanged();
    } catch {
      setError('Could not add that tag.');
    } finally {
      setBusyPath(null);
    }
  };

  const removeTag = async (note: NoteSummary, tag: string) => {
    setBusyPath(note.relPath);
    setError(null);
    try {
      await api.setTags(note.relPath, note.tags.filter((t) => t !== tag));
      onChanged();
    } catch {
      setError('Could not remove that tag.');
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-slate-100">Inbox triage</h1>
      <div className="mb-4 text-sm text-slate-500">
        {items.length} note{items.length === 1 ? '' : 's'} waiting in 1. Inbox — tag them, move them into a Resources
        folder, or archive them.
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-sm text-red-300">{error}</div>
      )}

      {items.length === 0 ? (
        <div className="text-sm text-slate-500">Inbox is empty — nothing to triage.</div>
      ) : (
        <div className="space-y-2">
          {items.map((note) => (
            <div key={note.relPath} className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => onNavigate(note.relPath)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium text-slate-100 hover:text-violet-300">{note.title}</div>
                  <div className="truncate text-xs text-slate-500">{note.excerpt}</div>
                </button>
                <div className="flex flex-shrink-0 gap-1.5">
                  <button
                    onClick={() => (movingPath === note.relPath ? setMovingPath(null) : startMove(note.relPath))}
                    disabled={busyPath === note.relPath}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300 disabled:opacity-50"
                  >
                    ⇒ Move
                  </button>
                  <button
                    onClick={() => archive(note.relPath)}
                    disabled={busyPath === note.relPath}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50"
                  >
                    📦 Archive
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {note.tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-full border border-slate-800 px-2 py-0.5 text-xs text-slate-400"
                  >
                    #{tag}
                    <button onClick={() => removeTag(note, tag)} className="text-slate-600 hover:text-red-400">
                      ×
                    </button>
                  </span>
                ))}
                <input
                  value={tagDrafts[note.relPath] ?? ''}
                  onChange={(e) => setTagDrafts((prev) => ({ ...prev, [note.relPath]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && addTag(note)}
                  placeholder="+ tag"
                  className="w-20 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-slate-300 placeholder:text-slate-600 focus:border-slate-700 focus:bg-slate-950 focus:outline-none"
                />
              </div>

              {movingPath === note.relPath && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-2">
                  <select
                    value={moveFolder}
                    onChange={(e) => setMoveFolder(e.target.value)}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-violet-500 focus:outline-none"
                  >
                    {options?.resourceFolders.map((f) => (
                      <option key={f} value={f}>
                        4. Resources / {f}
                      </option>
                    ))}
                    <option value={NEW_FOLDER_SENTINEL}>+ New resource folder…</option>
                  </select>
                  {moveFolder === NEW_FOLDER_SENTINEL && (
                    <input
                      value={moveNewFolder}
                      onChange={(e) => setMoveNewFolder(e.target.value)}
                      placeholder="New folder name"
                      className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-violet-500 focus:outline-none"
                    />
                  )}
                  <button
                    onClick={() => confirmMove(note.relPath)}
                    disabled={busyPath === note.relPath}
                    className="rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    Move
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
