import { useEffect, useState } from 'react';
import { api } from '../api';
import { CheckIcon, TrashIcon } from './mailIcons';
import { NewNoteModal } from './NewNoteModal';
import type { DownloadSummary } from '../types';

/**
 * Opened by clicking a downloaded item on the home page's Downloads widget — watch it, delete it,
 * or jump into note-creation without losing your place. "New note" renders the *exact* same
 * `NewNoteModal` the main "+ New note" button uses (same component, same title/project/area/
 * folder fields), just without that flow's usual "navigate to the new note afterward" step — this
 * modal stays open and the video keeps playing underneath, since the whole point here is
 * capturing a note about what you're watching without losing it.
 */
export function DownloadPreviewModal({
  item,
  defaultVolume,
  onClose,
  onDeleted,
}: {
  item: DownloadSummary;
  /** 0–1, from the Settings page's "Playback" default-volume slider — applied once when the
   * player mounts, not re-applied afterward, so dragging *this* video's own volume slider while
   * watching isn't fought by a prop re-render. */
  defaultVolume: number;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  // A callback ref (not `useEffect`) — fires exactly once, synchronously, when the `<video>`/
  // `<audio>` element is actually created, so the volume is already right for that very first
  // frame instead of momentarily showing the browser's own 100% default.
  const setInitialVolume = (el: HTMLVideoElement | HTMLAudioElement | null) => {
    if (el) el.volume = Math.min(1, Math.max(0, defaultVolume));
  };
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [noteCreated, setNoteCreated] = useState(false);

  // Same auto-revert as the mail page's armed-delete buttons — arming and then walking away from
  // it (or just not following through) should quietly reset, not stay armed indefinitely.
  useEffect(() => {
    if (!confirmingDelete) return;
    const t = setTimeout(() => setConfirmingDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmingDelete]);

  const handleDeleteClick = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    setDeleting(true);
    setError(null);
    try {
      const result = await api.deleteDownload(item.id);
      if (!result.ok) {
        setError(result.error ?? 'Could not delete that.');
        return;
      }
      onDeleted(item.id);
      onClose();
    } catch {
      setError('Could not reach the downloads dashboard.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
        <div
          className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
        <div className="flex-shrink-0 border-b border-slate-800 p-4">
          <h2 className="truncate font-display text-lg font-semibold text-slate-100" title={item.title ?? undefined}>
            <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-violet-300">
              {item.title ?? item.url}
            </a>
          </h2>
          {item.author && <div className="text-xs text-slate-500">{item.author}</div>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-black">
          {item.status === 'downloading' && (
            <div className="flex h-64 items-center justify-center text-sm text-slate-400">
              Still downloading — check back shortly.
            </div>
          )}
          {item.status === 'failed' && (
            <div className="flex h-64 flex-col items-center justify-center gap-1 px-6 text-center text-sm text-red-300">
              <div>Download failed.</div>
              {item.errorMessage && <div className="text-slate-500">{item.errorMessage}</div>}
            </div>
          )}
          {item.status === 'done' && item.mediaUrl && item.mediaType === 'video' && (
            <video ref={setInitialVolume} src={item.mediaUrl} controls className="max-h-[60vh] w-full" />
          )}
          {item.status === 'done' && item.mediaUrl && item.mediaType === 'image' && (
            <img src={item.mediaUrl} alt="" className="mx-auto max-h-[60vh]" />
          )}
          {item.status === 'done' && item.mediaUrl && item.mediaType === 'audio' && (
            <div className="flex h-32 items-center justify-center px-6">
              <audio ref={setInitialVolume} src={item.mediaUrl} controls className="w-full" />
            </div>
          )}
          {item.status === 'done' && !item.mediaUrl && (
            <div className="flex h-64 items-center justify-center text-sm text-slate-500">No playable media.</div>
          )}
        </div>

        {error && <div className="flex-shrink-0 px-4 pt-3 text-sm text-red-300">{error}</div>}
        {noteCreated && (
          <div className="flex-shrink-0 px-4 pt-3 text-sm text-emerald-400">✓ Note created.</div>
        )}

        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-slate-800 p-3">
          <button
            onClick={() => setNewNoteOpen(true)}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-violet-500/50 hover:text-violet-300"
          >
            📝 New note
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleDeleteClick()}
              disabled={deleting}
              title={confirmingDelete ? 'Click again to confirm delete' : 'Delete'}
              className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                confirmingDelete
                  ? 'border-emerald-500/50 text-emerald-400'
                  : 'border-slate-700 text-slate-300 hover:border-red-500/50 hover:text-red-400'
              }`}
            >
              {confirmingDelete ? <CheckIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
              {deleting ? 'Deleting…' : confirmingDelete ? 'Confirm delete' : 'Delete'}
            </button>
            <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
              Close
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Rendered as a sibling, not nested inside the backdrop div above — NewNoteModal's own
          backdrop click handler calls its own `onClose` without stopping propagation (same as
          this modal's does), so nesting it would let a click meant to dismiss *it* bubble up and
          close this video modal too. Siblings don't share that bubble path. */}
      {newNoteOpen && (
        <NewNoteModal
          onClose={() => setNewNoteOpen(false)}
          onCreated={() => {
            // Deliberately doesn't navigate to the new note (what the main "+ New note" button
            // does) — this modal, and the video behind it, stay open exactly as they were.
            setNewNoteOpen(false);
            setNoteCreated(true);
          }}
        />
      )}
    </>
  );
}
