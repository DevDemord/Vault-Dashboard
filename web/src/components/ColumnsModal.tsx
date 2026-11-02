import { useRef, useState } from 'react';
import { CALLOUT_TYPE_OPTIONS } from './calloutTypes';
import type { ColumnData } from './multiColumnBlock';

const MAX_COLUMNS = 6;
const emptyColumn = (): ColumnData => ({ type: 'note', title: '', content: '' });

/**
 * Splices a ``` fence template into `content` right after the line the cursor is on (not at the
 * exact character offset — matches `MarkdownEditor.insertAtCursor`'s own convention, so inserting
 * a code block feels the same here as it does in the real editor), blank-line separated from
 * whatever's already there. Returns the new text plus where the cursor should land — the blank
 * line inside the fence, same spot the main editor's auto-close-fence feature drops you.
 */
function insertCodeFence(content: string, cursor: number): { text: string; cursorPos: number } {
  const nextNewline = content.indexOf('\n', cursor);
  const lineEnd = nextNewline === -1 ? content.length : nextNewline;
  const before = content.slice(0, lineEnd);
  const after = content.slice(lineEnd);
  const prefix = before ? '\n\n' : '';
  const fence = '```\n\n```';
  const text = `${before}${prefix}${fence}${after ? '\n' + after : ''}`;
  const cursorPos = before.length + prefix.length + 4; // just after "```\n" — the blank line
  return { text, cursorPos };
}

/**
 * Builds or edits a `[!multi-column]` block's columns through plain inputs instead of hand-typed
 * `>>` markdown — NoteView decides insert-new vs. edit-existing (based on whether the cursor was
 * sitting inside an existing block) and hands this component the starting columns either way.
 */
export function ColumnsModal({
  mode,
  initialColumns,
  onClose,
  onSubmit,
}: {
  mode: 'insert' | 'edit';
  initialColumns: ColumnData[];
  onClose: () => void;
  onSubmit: (columns: ColumnData[]) => void;
}) {
  const [columns, setColumns] = useState<ColumnData[]>(initialColumns);
  const textareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});

  const updateColumn = (index: number, patch: Partial<ColumnData>) => {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const addColumn = () => setColumns((prev) => (prev.length >= MAX_COLUMNS ? prev : [...prev, emptyColumn()]));
  const removeColumn = (index: number) => setColumns((prev) => prev.filter((_, i) => i !== index));

  const insertCodeBlock = (index: number) => {
    const textarea = textareaRefs.current[index];
    const content = columns[index].content;
    const cursor = textarea?.selectionStart ?? content.length;
    const { text, cursorPos } = insertCodeFence(content, cursor);
    updateColumn(index, { content: text });
    // One tick later: the textarea's value only reflects `text` once this state update has
    // actually re-rendered, so focusing/selecting immediately would still be acting on the old
    // (shorter) string and clamp to the wrong spot.
    requestAnimationFrame(() => {
      const el = textareaRefs.current[index];
      el?.focus();
      el?.setSelectionRange(cursorPos, cursorPos);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg font-semibold text-slate-100">
          {mode === 'edit' ? 'Edit columns' : 'Insert columns'}
        </h2>
        <div className="mb-4 text-sm text-slate-500">
          Each column becomes its own callout, laid out side by side. No need to type the {'>'} yourself.
        </div>

        <div className="space-y-3">
          {columns.map((col, i) => (
            <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="mb-2 flex items-center gap-2">
                <select
                  value={col.type}
                  onChange={(e) => updateColumn(i, { type: e.target.value })}
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
                >
                  {CALLOUT_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  value={col.title}
                  onChange={(e) => updateColumn(i, { title: e.target.value })}
                  placeholder={`Title (optional — defaults to "${col.type}")`}
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
                ref={(el) => {
                  textareaRefs.current[i] = el;
                }}
                value={col.content}
                onChange={(e) => updateColumn(i, { content: e.target.value })}
                placeholder="Column content — plain markdown"
                rows={4}
                className={`w-full resize-y rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none ${
                  col.content.includes('```') ? 'font-mono' : ''
                }`}
              />
              <button
                onClick={() => insertCodeBlock(i)}
                title="Insert a code block at the cursor"
                className="mt-1.5 rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
              >
                {'</>'} Code block
              </button>
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
