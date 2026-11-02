import type { NoteSummary } from '../types';

export function OrphansView({ items, onNavigate }: { items: NoteSummary[]; onNavigate: (relPath: string) => void }) {
  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-slate-100">Orphaned notes</h1>
      <div className="mb-4 text-sm text-slate-500">
        Notes with no backlinks and no outgoing links to other notes — disconnected from the rest of the vault.
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No orphans — every note is linked to something.</div>
      ) : (
        <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800/80 bg-slate-900/40 shadow-sm shadow-black/20">
          {items.map((note) => (
            <button
              key={note.relPath}
              onClick={() => onNavigate(note.relPath)}
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
      )}
    </div>
  );
}
