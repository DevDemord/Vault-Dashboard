import type { NoteSummary } from '../types';

/**
 * Picker for a top-level PARA folder's notes — opened from the collapsed sidebar's per-folder
 * icon. Deliberately a modal rather than filtering the home page's "Recently edited" list in
 * place, so browsing a folder never changes what that column shows.
 */
export function FolderNotesModal({
  folder,
  notes,
  onClose,
  onSelect,
}: {
  folder: string;
  notes: NoteSummary[];
  onClose: () => void;
  onSelect: (relPath: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg font-semibold text-slate-100">{folder}</h2>
        <p className="mb-4 text-xs text-slate-500">
          {notes.length} note{notes.length === 1 ? '' : 's'}
        </p>

        {notes.length > 0 ? (
          <div className="scroll-pane max-h-[60vh] divide-y divide-slate-800/80 overflow-y-auto rounded-xl border border-slate-800/80">
            {notes.map((note) => (
              <button
                key={note.relPath}
                onClick={() => onSelect(note.relPath)}
                className="group block w-full border-l-2 border-transparent px-3 py-2.5 text-left transition-all hover:border-violet-500 hover:bg-slate-800/50"
              >
                <div className="truncate text-sm font-medium text-slate-100 transition-colors group-hover:text-violet-200">
                  {note.title}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {note.folder || '(root)'} · {note.excerpt}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No notes in this folder.</div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
