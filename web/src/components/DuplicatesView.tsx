import type { DuplicatePair } from '../types';

export function DuplicatesView({ items, onNavigate }: { items: DuplicatePair[]; onNavigate: (relPath: string) => void }) {
  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-slate-100">Possible duplicates</h1>
      <div className="mb-4 text-sm text-slate-500">
        Pairs of notes with substantially overlapping content (word-set similarity of 30% or more), narrowed from
        the full vault via the same search index used elsewhere, then scored directly — worth a look as merge
        candidates, not necessarily actual duplicates.
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No highly similar note pairs found.</div>
      ) : (
        <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800/80 bg-slate-900/40 shadow-sm shadow-black/20">
          {items.map((pair, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  onClick={() => onNavigate(pair.a.relPath)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-100 hover:text-violet-300"
                  title={pair.a.relPath}
                >
                  {pair.a.title}
                </button>
                <span className="flex-shrink-0 text-xs text-slate-500">↔</span>
                <button
                  onClick={() => onNavigate(pair.b.relPath)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-100 hover:text-violet-300"
                  title={pair.b.relPath}
                >
                  {pair.b.title}
                </button>
              </div>
              <span className="flex-shrink-0 rounded-full border border-slate-800 px-2 py-0.5 text-xs text-slate-400">
                {Math.round(pair.similarity * 100)}% similar
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
