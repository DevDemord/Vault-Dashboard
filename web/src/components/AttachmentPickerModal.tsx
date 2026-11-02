function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

/**
 * Full-size modal for picking an existing image out of `_Attachments` — replaces what used to be
 * a cramped dropdown anchored to the "🖼" button (fine for 2 images, not for a vault with dozens).
 * Renders as its own `fixed inset-0` overlay on top of whatever modal opened it (e.g.
 * CalloutSettingsModal); the opener's own backdrop-click-to-close handler never fires because this
 * modal's content div stops propagation the same way every other modal in this app already does.
 */
export function AttachmentPickerModal({
  files,
  onClose,
  onSelect,
}: {
  files: { relPath: string; size: number }[];
  onClose: () => void;
  onSelect: (relPath: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg font-semibold text-slate-100">Choose an image</h2>
        <p className="mb-4 text-xs text-slate-500">Pick a file already in _Attachments.</p>

        {files.length > 0 ? (
          <div className="scroll-pane grid max-h-[60vh] grid-cols-4 gap-2.5 overflow-y-auto pr-1">
            {files.map((file) => (
              <button
                key={file.relPath}
                onClick={() => onSelect(file.relPath)}
                title={`${fileName(file.relPath)} · ${formatSize(file.size)}`}
                className="flex flex-col items-center gap-1 rounded-lg border border-slate-800 p-1.5 hover:border-violet-500/50"
              >
                <img
                  src={`/api/attachments/${encodeURIComponent(file.relPath)}`}
                  alt=""
                  className="h-14 w-14 rounded object-cover"
                />
                <span className="w-full truncate text-center text-[10px] text-slate-500">{fileName(file.relPath)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No attachments in the vault yet.</div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
