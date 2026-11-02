import type { BookmarkItem } from '../types';

export function BookmarksView({ items, onNavigate }: { items: BookmarkItem[]; onNavigate: (relPath: string) => void }) {
  if (items.length === 0) {
    return <div className="text-sm text-slate-500">No bookmarked links found anywhere in the vault yet.</div>;
  }

  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-semibold text-slate-100">Bookmarks</h1>
      <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2 px-3 py-2.5">
            <span className={`mt-0.5 text-sm ${item.done ? 'text-violet-400' : 'text-slate-600'}`}>
              {item.done ? '☑' : '☐'}
            </span>
            <div className="min-w-0 flex-1">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`block truncate text-sm ${item.done ? 'text-slate-500 line-through' : 'text-cyan-400 hover:text-cyan-300'}`}
              >
                {item.url}
              </a>
              <button onClick={() => onNavigate(item.sourcePath)} className="text-xs text-slate-500 hover:text-violet-300">
                {item.sourceTitle}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
