import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { CreateOptions, NoteDetail } from '../types';

const INBOX = '1. Inbox';
const NEW_FOLDER_SENTINEL = '__new__';

export function NewNoteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (note: NoteDetail) => void }) {
  const [options, setOptions] = useState<CreateOptions | null>(null);
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [area, setArea] = useState('');
  const [folder, setFolder] = useState(INBOX);
  const [newFolder, setNewFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.createOptions().then(setOptions);
  }, []);

  const handleSubmit = async () => {
    const resolvedFolder = folder === NEW_FOLDER_SENTINEL ? newFolder.trim() : folder;
    if (!title.trim()) return setError('Title is required.');
    if (!resolvedFolder) return setError('Pick or name a folder.');

    setSaving(true);
    setError(null);
    try {
      const note = await api.createNote({
        title: title.trim(),
        folder: resolvedFolder,
        project: project || undefined,
        area: area || undefined,
      });
      onCreated(note);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the note.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 font-display text-lg font-semibold text-slate-100">New note</h2>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-400">Name</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
            placeholder="e.g. Proxmox - Backup Setup"
          />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Project</span>
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
            >
              <option value="">None</option>
              {options?.projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Area</span>
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
            >
              <option value="">None</option>
              {options?.areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-400">Folder</span>
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
          >
            <option value={INBOX}>📥 1. Inbox (drop all)</option>
            {options?.resourceFolders.map((f) => (
              <option key={f} value={f}>
                4. Resources / {f}
              </option>
            ))}
            <option value={NEW_FOLDER_SENTINEL}>+ New resource folder…</option>
          </select>
          {folder === NEW_FOLDER_SENTINEL && (
            <input
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              placeholder="New folder name"
              className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
            />
          )}
        </label>

        {error && <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-sm text-red-300">{error}</div>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create note'}
          </button>
        </div>
      </div>
    </div>
  );
}
