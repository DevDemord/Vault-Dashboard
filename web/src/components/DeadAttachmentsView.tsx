import type { DeadAttachment } from '../types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read-only by design — the mirror image of Orphans, for files instead of notes. No delete
 * action here; deleting a file you might still want is a one-way door this view shouldn't open
 * on its own, so it just tells you where to look. */
export function DeadAttachmentsView({ items }: { items: DeadAttachment[] }) {
  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-slate-100">Dead attachments</h1>
      <div className="mb-4 text-sm text-slate-500">
        Files in <code>_Attachments</code> that no note's image/embed syntax resolves to anymore. Open one to check
        before deleting it yourself — this view is read-only on purpose.
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No unreferenced attachments — everything in _Attachments is linked from somewhere.</div>
      ) : (
        <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800/80 bg-slate-900/40 shadow-sm shadow-black/20">
          {items.map((att) => (
            <a
              key={att.relPath}
              href={`/api/attachments/${att.relPath.split('/').map(encodeURIComponent).join('/')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-3 border-l-2 border-transparent px-3 py-2.5 transition-all hover:border-violet-500 hover:bg-slate-800/50"
            >
              <span className="truncate text-sm font-medium text-slate-100 transition-colors group-hover:text-violet-200">
                {att.relPath}
              </span>
              <span className="flex-shrink-0 text-xs text-slate-500">{formatSize(att.size)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
