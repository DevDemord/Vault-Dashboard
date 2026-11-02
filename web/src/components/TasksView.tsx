import { useMemo, useState } from 'react';
import type { ChecklistItem } from '../types';

export function TasksView({
  items,
  onNavigate,
  onToggle,
  onAdd,
}: {
  items: ChecklistItem[];
  onNavigate: (relPath: string) => void;
  onToggle: (item: ChecklistItem, done: boolean) => void;
  onAdd: (text: string) => Promise<void>;
}) {
  const [newText, setNewText] = useState('');
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of items) {
      const key = item.group ?? 'Ungrouped';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [items]);

  const submitNewTask = async () => {
    const trimmed = newText.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      await onAdd(trimmed);
      setNewText('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-semibold text-slate-100">Tasks</h1>

      <div className="mb-6 flex items-center gap-2">
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitNewTask()}
          placeholder="Add a task…"
          className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
        />
        <button
          onClick={submitNewTask}
          disabled={adding || !newText.trim()}
          className="flex-shrink-0 rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {items.length === 0 && (
        <div className="text-sm text-slate-500">No open or completed tasks found anywhere in the vault yet.</div>
      )}

      {groups.map(([group, groupItems]) => (
        <div key={group} className="mb-6">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{group}</div>
          <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {groupItems.map((item) => (
              <div key={`${item.sourcePath}:${item.line}`} className="flex items-start gap-2 px-3 py-2.5">
                <button
                  onClick={() => onToggle(item, !item.done)}
                  title={item.done ? 'Mark as not done' : 'Mark as done'}
                  className={`mt-0.5 text-sm transition-colors ${
                    item.done ? 'text-violet-400 hover:text-violet-300' : 'text-slate-600 hover:text-violet-300'
                  }`}
                >
                  {item.done ? '☑' : '☐'}
                </button>
                <div className="flex-1">
                  <div className={`text-sm ${item.done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                    {item.text}
                  </div>
                  <button
                    onClick={() => onNavigate(item.sourcePath)}
                    className="text-xs text-slate-500 hover:text-violet-300"
                  >
                    {item.sourceTitle}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
