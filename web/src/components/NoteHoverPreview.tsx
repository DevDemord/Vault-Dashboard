import { useRef, useState, type ReactNode } from 'react';
import type { NoteSummary } from '../types';

const SHOW_DELAY_MS = 350;

/**
 * Wraps a note link/button (folder tree entries, backlink chips) and shows a small preview
 * popover on hover after a short delay — title, folder, excerpt, and up to 5 tags, all from data
 * the caller already has in hand (`NoteSummary`'s existing `excerpt` field) rather than a new
 * fetch per hover. Not wired into search results, which already show the excerpt inline per row.
 *
 * `display: contents` on the wrapper keeps it invisible to layout — wrapping a button in a plain
 * block/flex div here would otherwise change how it sits inside the folder tree's or backlink
 * row's own flex/block flow.
 */
export function NoteHoverPreview({ note, children }: { note: NoteSummary; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const scheduleShow = () => {
    timerRef.current = setTimeout(() => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({
        left: Math.min(rect.right + 10, window.innerWidth - 300),
        top: Math.min(rect.top, window.innerHeight - 180),
      });
      setShow(true);
    }, SHOW_DELAY_MS);
  };

  const cancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setShow(false);
  };

  return (
    <div ref={wrapRef} className="contents" onMouseEnter={scheduleShow} onMouseLeave={cancel}>
      {children}
      {show && pos && (
        <div
          className="pointer-events-none fixed z-[70] w-72 rounded-lg border border-slate-800 bg-slate-900 p-3 shadow-2xl"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="mb-0.5 truncate font-display text-sm font-semibold text-slate-100">{note.title}</div>
          <div className="mb-1.5 text-[11px] text-slate-500">{note.folder || '(root)'}</div>
          <div className="line-clamp-4 text-xs text-slate-400">{note.excerpt || 'No preview available.'}</div>
          {note.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {note.tags.slice(0, 5).map((t) => (
                <span key={t} className="rounded-full border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
