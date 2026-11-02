import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { ArrowSquareOut, Image as ImageIcon } from '@phosphor-icons/react';
import { api } from '../api';
import type { NoteDetail } from '../types';

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;

export type PreviewItem = { type: 'note'; relPath: string } | { type: 'attachment'; relPath: string };

/**
 * Explorer's third pane — a quick glance at whatever note or file is clicked in the middle
 * column, since a note's title alone is often not enough to tell what's actually in it before
 * deciding where to move it. Deliberately lighter than the full `NoteView`: plain GFM markdown
 * (no callout styling, no heading-anchor jump targets, no editing) — this is a "what is this"
 * check, not a second place to read or edit notes.
 */
export function NotePreviewPanel({
  item,
  onOpenNote,
}: {
  item: PreviewItem | null;
  onOpenNote: (relPath: string) => void;
}) {
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const notePath = item?.type === 'note' ? item.relPath : null;

  useEffect(() => {
    if (!notePath) {
      setNote(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    api
      .note(notePath)
      .then((n) => {
        if (!cancelled) setNote(n);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [notePath]);

  if (!item) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-xl border border-slate-800/80 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
        Click a note or file to preview it here.
      </div>
    );
  }

  if (item.type === 'attachment') {
    const url = `/api/attachments/${encodeURIComponent(item.relPath)}`;
    const name = item.relPath.slice(item.relPath.lastIndexOf('/') + 1);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
        <div className="mb-2 flex-shrink-0 truncate text-sm font-medium text-slate-200">{name}</div>
        {IMAGE_EXT.test(item.relPath) ? (
          <img src={url} alt={name} className="max-h-full w-full flex-shrink-0 rounded-lg object-contain" />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-slate-500">
            <ImageIcon size={28} weight="regular" className="opacity-40" />
            No preview available for this file type.
          </div>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex-shrink-0 self-start text-xs text-violet-300 hover:underline"
        >
          Open in new tab ↗
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
      {loading && <div className="text-sm text-slate-500">Loading…</div>}
      {error && <div className="text-sm text-red-400">Could not load this note.</div>}
      {!loading && !error && note && (
        <>
          <div className="mb-1 flex flex-shrink-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-display text-base font-semibold text-slate-100">{note.title}</div>
              <div className="text-xs text-slate-500">{note.folder || '(root)'}</div>
            </div>
            <button
              onClick={() => onOpenNote(note.relPath)}
              className="flex-shrink-0 rounded-full bg-violet-500/15 px-2.5 py-1 text-xs text-violet-300 hover:bg-violet-500/25"
            >
              Open →
            </button>
          </div>
          {note.tags.length > 0 && (
            <div className="mb-2 flex flex-shrink-0 flex-wrap gap-1">
              {note.tags.map((t) => (
                <span key={t} className="rounded-full border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                  #{t}
                </span>
              ))}
            </div>
          )}
          <div className="prose-note mt-1 text-sm">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={{
                a: ({ href, children, ...props }) => {
                  if (href?.startsWith('obsidian://')) {
                    return (
                      <span
                        className="text-slate-500 underline decoration-dotted"
                        title="Internal link — open the note to follow it"
                      >
                        {children}
                      </span>
                    );
                  }
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="external-link" {...props}>
                      {children}
                    </a>
                  );
                },
              }}
            >
              {note.renderedBody}
            </ReactMarkdown>
          </div>
        </>
      )}
    </div>
  );
}
