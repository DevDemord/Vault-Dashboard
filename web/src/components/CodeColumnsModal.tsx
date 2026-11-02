import { useState } from 'react';
import type { CodeColumnData } from './codeColumnsBlock';

const MAX_COLUMNS = 4;
const emptyColumn = (): CodeColumnData => ({ language: '', content: '' });

/**
 * Builds or edits a `[!code-columns]` block's columns through plain inputs — same role as
 * ColumnsModal, but for bare code side by side instead of callouts: no title, no callout type,
 * just a language tag and the code itself. NoteView decides insert-new vs. edit-existing the same
 * way it does for the regular Columns button.
 */
export function CodeColumnsModal({
  mode,
  initialColumns,
  onClose,
  onSubmit,
}: {
  mode: 'insert' | 'edit';
  initialColumns: CodeColumnData[];
  onClose: () => void;
  onSubmit: (columns: CodeColumnData[]) => void;
}) {
  const [columns, setColumns] = useState<CodeColumnData[]>(initialColumns);

  const updateColumn = (index: number, patch: Partial<CodeColumnData>) => {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const addColumn = () => setColumns((prev) => (prev.length >= MAX_COLUMNS ? prev : [...prev, emptyColumn()]));
  const removeColumn = (index: number) => setColumns((prev) => prev.filter((_, i) => i !== index));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg font-semibold text-slate-100">
          {mode === 'edit' ? 'Edit code columns' : 'Insert code columns'}
        </h2>
        <div className="mb-4 text-sm text-slate-500">
          Plain code blocks side by side — no callout card, just the code. No need to type the {'>'} or ``` yourself.
        </div>

        <div className="flex flex-wrap gap-3">
          {columns.map((col, i) => (
            <div key={i} className="min-w-[14rem] flex-1 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="mb-2 flex items-center gap-2">
                <input
                  value={col.language}
                  onChange={(e) => updateColumn(i, { language: e.target.value })}
                  placeholder="language (e.g. js, python) — optional"
                  className="flex-1 rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
                />
                {columns.length > 1 && (
                  <button
                    onClick={() => removeColumn(i)}
                    title="Remove this column"
                    className="flex-shrink-0 rounded px-1.5 py-1 text-slate-500 hover:text-red-400"
                  >
                    ✕
                  </button>
                )}
              </div>
              <textarea
                value={col.content}
                onChange={(e) => updateColumn(i, { content: e.target.value })}
                placeholder="Code — just the code, no ``` fences needed"
                rows={8}
                spellCheck={false}
                className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
              />
            </div>
          ))}
        </div>

        {columns.length < MAX_COLUMNS && (
          <button
            onClick={addColumn}
            className="mt-3 rounded border border-dashed border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
          >
            + Add column
          </button>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(columns)}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500"
          >
            {mode === 'edit' ? 'Save columns' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  );
}
