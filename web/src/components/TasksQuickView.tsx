import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChecklistItem } from '../types';

function TaskRow({
  item,
  onNavigate,
  onToggle,
}: {
  item: ChecklistItem;
  onNavigate: (relPath: string) => void;
  onToggle: (item: ChecklistItem, done: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-slate-800/60 px-3 py-2 last:border-0 hover:bg-slate-800/40">
      <button
        onClick={() => onToggle(item, !item.done)}
        title={item.done ? 'Mark as not done' : 'Mark as done'}
        className={`mt-0.5 flex-shrink-0 text-sm transition-colors ${
          item.done ? 'text-violet-400 hover:text-violet-300' : 'text-slate-600 hover:text-violet-300'
        }`}
      >
        {item.done ? '☑' : '☐'}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${item.done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{item.text}</div>
        <button onClick={() => onNavigate(item.sourcePath)} className="text-xs text-slate-500 hover:text-violet-300">
          {item.sourceTitle}
        </button>
      </div>
    </div>
  );
}

export function TasksQuickView({
  tasks,
  onNavigate,
  onToggle,
  onAdd,
  onViewAll,
}: {
  tasks: ChecklistItem[];
  onNavigate: (relPath: string) => void;
  onToggle: (item: ChecklistItem, done: boolean) => void;
  onAdd: (text: string) => Promise<void>;
  onViewAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newText, setNewText] = useState('');
  const [adding, setAdding] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const openTasks = useMemo(() => tasks.filter((t) => !t.done).sort((a, b) => b.mtime - a.mtime), [tasks]);
  const headline = openTasks[0];
  const rest = openTasks.slice(1, 9);

  return (
    <div ref={panelRef} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[11rem] items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition hover:border-violet-500/40 sm:max-w-[16rem]"
      >
        <span className="flex-shrink-0">✅</span>
        <span className="truncate">{headline ? headline.text : 'No open tasks'}</span>
        <span className="ml-auto flex-shrink-0 text-xs text-slate-500">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="scroll-pane absolute right-0 z-20 mt-1 max-h-96 w-80 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 shadow-xl">
          <div className="flex items-center gap-1.5 border-b border-slate-800 p-2">
            <input
              autoFocus
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitNewTask()}
              placeholder="Add a task…"
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            <button
              onClick={submitNewTask}
              disabled={adding || !newText.trim()}
              className="flex-shrink-0 rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {!headline && <div className="px-3 py-4 text-sm text-slate-500">No open tasks — nice.</div>}
          {headline && <TaskRow item={headline} onNavigate={onNavigate} onToggle={onToggle} />}
          {rest.map((item) => (
            <TaskRow key={`${item.sourcePath}:${item.line}`} item={item} onNavigate={onNavigate} onToggle={onToggle} />
          ))}
          <button
            onClick={() => {
              setOpen(false);
              onViewAll();
            }}
            className="block w-full border-t border-slate-800 px-3 py-2 text-left text-xs text-violet-300 hover:bg-slate-800/60"
          >
            View all tasks →
          </button>
        </div>
      )}
    </div>
  );
}
