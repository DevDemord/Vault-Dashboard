import { useEffect, useState } from 'react';
import { api } from '../api';
import { MAIL_LIMIT } from '../mailConstants';
import { MailMessageRow } from './MailMessageRow';
import { MailPreviewModal } from './MailPreviewModal';
import { useMailRowActions } from './useMailRowActions';
import type { MailAccountStatus, MailMessage, MailStatus } from '../types';

const POLL_MS = 60_000;
/** How many messages this compact home-page column shows — the full per-account lists (and
 * mark-all/refresh actions) live on the Mail page this widget links out to; this is just
 * "what's new" at a glance, same spirit as "Recently edited" beside it. */
const SHOWN_LIMIT = 6;

/**
 * Home-page column (sits beside "Recently edited") showing the most recent unread mail across
 * every configured Gmail account, flattened into one list sorted by date — unlike the Mail page's
 * one-column-per-account layout, there isn't room here for that, and "what's newest overall" is
 * the more useful glance for a widget this size anyway. Each row carries the same move-to-folder
 * and delete actions as the full Mail page (via the shared `MailMessageRow`/`useMailRowActions`),
 * plus an account pill (its address's local part) since rows from different inboxes are mixed
 * together here — something the Mail page's own per-account columns don't need. Polls the same
 * shared cache key (`MAIL_LIMIT`) the GmailWidget pill and the full Mail page already warm, so
 * this doesn't cost an extra IMAP round trip on top of theirs. Renders nothing at all if no
 * accounts are configured, same as GmailWidget — silently absent rather than showing an empty
 * state for a feature nobody opted into.
 */
export function UnreadMailWidget({ onOpenMail }: { onOpenMail: () => void }) {
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [markingUids, setMarkingUids] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ address: string; uid: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .mailUnread(MAIL_LIMIT)
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const updateAccount = (address: string, updated: MailAccountStatus) => {
    setStatus((prev) =>
      prev ? { ...prev, accounts: prev.accounts.map((a) => (a.address === address ? updated : a)) } : prev,
    );
  };

  // No `onError` passed through — a background glance widget stays silently stale till the next
  // poll on failure rather than growing its own error banner; the Mail page itself already
  // surfaces errors for whoever notices something's off and goes looking.
  const { movingUids, deletingUids, folderMenuKey, foldersByAccount, confirmDeleteKey, toggleFolderMenu, moveMessage, handleTrashClick } =
    useMailRowActions({ limit: MAIL_LIMIT, updateAccount });

  if (!status || !status.configured || status.accounts.length === 0) return null;

  const totalCount = status.accounts.reduce((sum, a) => sum + a.count, 0);
  const anyError = status.accounts.some((a) => a.error);

  const flattened: (MailMessage & { address: string })[] = status.accounts
    .flatMap((a) => a.messages.map((m) => ({ ...m, address: a.address })))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, SHOWN_LIMIT);

  const markRead = async (address: string, uid: number) => {
    const k = `${address}:${uid}`;
    setMarkingUids((prev) => new Set(prev).add(k));
    try {
      const updated = await api.markMailRead(address, [uid], MAIL_LIMIT);
      updateAccount(address, updated);
    } catch {
      // Silent — see the note on `onError` above.
    } finally {
      setMarkingUids((prev) => {
        const copy = new Set(prev);
        copy.delete(k);
        return copy;
      });
    }
  };

  return (
    <div className="lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col">
      <div className="mb-2 flex flex-shrink-0 items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>{anyError ? '⚠️ Unread mail' : '📧 Unread mail'}</span>
        <button onClick={onOpenMail} className="font-normal normal-case text-slate-500 hover:text-violet-300">
          View all →
        </button>
      </div>
      <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800/80 bg-slate-900/40 shadow-sm shadow-black/20 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {flattened.length === 0 && <div className="px-3 py-4 text-sm text-slate-500">Inbox zero.</div>}
        {flattened.map((msg) => (
          <MailMessageRow
            key={`${msg.address}:${msg.uid}`}
            address={msg.address}
            msg={msg}
            accountPill
            markingUids={markingUids}
            movingUids={movingUids}
            deletingUids={deletingUids}
            folderMenuKey={folderMenuKey}
            confirmDeleteKey={confirmDeleteKey}
            folders={foldersByAccount[msg.address]}
            onMarkRead={markRead}
            onPreview={(address, uid) => setPreview({ address, uid })}
            onToggleFolderMenu={toggleFolderMenu}
            onMove={moveMessage}
            onTrashClick={handleTrashClick}
          />
        ))}
        {totalCount > flattened.length && (
          <button
            onClick={onOpenMail}
            className="block w-full px-3 py-2 text-left text-xs text-violet-300 hover:bg-slate-800/60"
          >
            +{totalCount - flattened.length} more unread →
          </button>
        )}
      </div>

      {preview && (
        <MailPreviewModal
          address={preview.address}
          uid={preview.uid}
          onClose={() => setPreview(null)}
          onMarkRead={markRead}
        />
      )}
    </div>
  );
}
