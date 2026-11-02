import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { SearchResult } from '../types';

export function SearchBox({ onSelect }: { onSelect: (relPath: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .search(query)
        .then(setResults)
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setQuery('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
        <span className="text-slate-500">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Quick search your vault…  (press /)"
          className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        )}
      </div>

      {query.trim() && (
        <div className="scroll-pane absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 shadow-xl">
          {loading && <div className="px-3 py-3 text-sm text-slate-500">Searching…</div>}
          {!loading && results && results.length === 0 && (
            <div className="px-3 py-4 text-sm text-slate-400">
              No notes found for <span className="text-slate-200">"{query}"</span>.
              <div className="mt-1 text-xs text-slate-500">Nothing stored for this yet — create it in Obsidian.</div>
            </div>
          )}
          {!loading &&
            results?.map((r) => (
              <button
                key={r.relPath}
                onClick={() => {
                  onSelect(r.relPath);
                  setQuery('');
                }}
                className="block w-full border-b border-slate-800/60 px-3 py-2 text-left last:border-0 hover:bg-slate-800/60"
              >
                <div className="truncate text-sm font-medium text-slate-100">{r.title}</div>
                <div className="truncate text-xs text-slate-500">{r.folder || '(root)'}</div>
                <div className="mt-0.5 truncate text-xs text-slate-400">{r.excerpt}</div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
