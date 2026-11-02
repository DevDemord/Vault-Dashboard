import type { TagCount } from '../types';

export function TagList({
  tags,
  activeTag,
  onSelect,
}: {
  tags: TagCount[];
  activeTag: string | null;
  onSelect: (tag: string | null) => void;
}) {
  return (
    <div className="p-2">
      <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500">Tags</div>
      {tags.length === 0 && <div className="px-2 py-2 text-sm text-slate-500">No tags yet.</div>}
      <div className="flex flex-col gap-0.5">
        {tags.map(({ tag, count }) => (
          <button
            key={tag}
            onClick={() => onSelect(activeTag === tag ? null : tag)}
            className={`flex items-center justify-between rounded-full px-2.5 py-1 text-left text-sm transition-all ${
              activeTag === tag
                ? 'bg-gradient-to-r from-violet-500/20 to-fuchsia-500/10 text-violet-300 shadow-inner shadow-violet-900/20'
                : 'text-slate-400 hover:translate-x-0.5 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <span className="truncate">#{tag}</span>
            <span className="rounded-full bg-slate-800/80 px-1.5 text-xs text-slate-500">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
