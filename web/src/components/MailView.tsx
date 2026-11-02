import { useEffect, useState } from 'react';
import { api } from '../api';
import { MAIL_LIMIT as FULL_LIMIT } from '../mailConstants';
import { MailMessageRow } from './MailMessageRow';
import { MailPreviewModal } from './MailPreviewModal';
import { MailRulesPanel } from './MailRulesPanel';
import { useMailRowActions } from './useMailRowActions';
import type { MailAccountStatus, MailFolder, MailStatus } from '../types';

/** Jumps straight to a specific already-signed-in Google account's inbox via Gmail's `authuser`
 * query param — picks an account by address instead of by browser sign-in order (`/u/0/`,
 * `/u/1/`, which the server has no way to know and shifts around anyway). Only works if that
 * account is already signed into the browser the link is opened in. */
function gmailLinkFor(address: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#inbox`;
}

function AccountColumn({
  account,
  refreshing,
  markingUids,
  markingSenders,
  markingAll,
  movingUids,
  deletingUids,
  folderMenuKey,
  folders,
  confirmDeleteKey,
  onRefresh,
  onMarkRead,
  onMarkSenderRead,
  onMarkAllRead,
  onPreview,
  onToggleFolderMenu,
  onMove,
  onTrashClick,
}: {
  account: MailAccountStatus;
  refreshing: boolean;
  markingUids: Set<string>;
  markingSenders: Set<string>;
  markingAll: boolean;
  movingUids: Set<string>;
  deletingUids: Set<string>;
  folderMenuKey: string | null;
  folders: MailFolder[] | undefined;
  confirmDeleteKey: string | null;
  onRefresh: (address: string) => void;
  onMarkRead: (address: string, uid: number) => void;
  onMarkSenderRead: (address: string, fromAddress: string) => void;
  onMarkAllRead: (address: string) => void;
  onPreview: (address: string, uid: number) => void;
  onToggleFolderMenu: (address: string, uid: number) => void;
  onMove: (address: string, uid: number, destination: string) => void;
  onTrashClick: (address: string, uid: number) => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-800/80 bg-slate-900/40 shadow-sm shadow-black/20">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-3">
        <div className="truncate text-sm font-medium text-slate-100">{account.address}</div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {!account.error && (
            <div className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{account.count}</div>
          )}
          <button
            onClick={() => onRefresh(account.address)}
            disabled={refreshing}
            title="Refresh this account"
            className={`text-sm text-slate-500 transition-colors hover:text-violet-300 disabled:opacity-40 ${refreshing ? 'animate-spin' : ''}`}
          >
            ↻
          </button>
        </div>
      </div>

      <div className="scroll-pane max-h-[70vh] overflow-y-auto">
        {account.error && <div className="px-4 py-4 text-sm text-red-300">Couldn't check: {account.error}</div>}
        {!account.error && account.messages.length === 0 && (
          <div className="px-4 py-6 text-sm text-slate-500">No unread mail — inbox zero.</div>
        )}
        {!account.error &&
          account.messages.map((msg) => (
            <MailMessageRow
              key={msg.uid}
              address={account.address}
              msg={msg}
              markingUids={markingUids}
              markingSenders={markingSenders}
              movingUids={movingUids}
              deletingUids={deletingUids}
              folderMenuKey={folderMenuKey}
              confirmDeleteKey={confirmDeleteKey}
              folders={folders}
              onMarkRead={onMarkRead}
              onMarkSenderRead={onMarkSenderRead}
              onPreview={onPreview}
              onToggleFolderMenu={onToggleFolderMenu}
              onMove={onMove}
              onTrashClick={onTrashClick}
            />
          ))}
      </div>

      <div className="flex flex-col border-t border-slate-800/80">
        {!account.error && account.messages.length > 0 && (
          <button
            onClick={() => account.messages.forEach((m) => onMarkRead(account.address, m.uid))}
            title={
              account.count > account.messages.length
                ? `Only marks the ${account.messages.length} shown here — ${account.count} total unread`
                : undefined
            }
            className="px-4 py-2.5 text-left text-xs text-violet-300 hover:bg-slate-800/60"
          >
            {account.count > account.messages.length ? `Mark shown ${account.messages.length} read` : 'Mark all read'}
          </button>
        )}
        {!account.error && account.count > account.messages.length && (
          <button
            onClick={() => onMarkAllRead(account.address)}
            disabled={markingAll}
            title="One IMAP call covering every unread message, not just the ones shown here"
            className="border-t border-slate-800/60 px-4 py-2.5 text-left text-xs text-amber-300 hover:bg-slate-800/60 disabled:opacity-40"
          >
            {markingAll ? 'Marking…' : `Mark ALL ${account.count.toLocaleString()} unread as read`}
          </button>
        )}
        <a
          href={gmailLinkFor(account.address)}
          target="_blank"
          rel="noreferrer"
          className="border-t border-slate-800/60 px-4 py-2.5 text-left text-xs text-violet-300 hover:bg-slate-800/60"
        >
          Open this inbox →
        </a>
      </div>
    </div>
  );
}

/** One column per configured Gmail account, each showing its own full unread list. Reached by
 * clicking the GmailWidget pill in the top bar; not reachable from the sidebar since it's not a
 * vault-content view. Fixed breakpoint column counts (1 / 2 / 3, same `lg` breakpoint the rest
 * of the app uses for its desktop layout) rather than a flexible min-width-driven count, so three
 * configured accounts actually land in one row once the viewport is wide enough instead of
 * reserving a fixed minimum width per column and wrapping the third one down regardless of how
 * much room is actually left. */
export function MailView() {
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingUids, setMarkingUids] = useState<Set<string>>(new Set());
  const [markingSenders, setMarkingSenders] = useState<Set<string>>(new Set());
  const [refreshingAccounts, setRefreshingAccounts] = useState<Set<string>>(new Set());
  const [markingAllAccounts, setMarkingAllAccounts] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ address: string; uid: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .mailUnread(FULL_LIMIT)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load mail.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateAccount = (address: string, updated: MailAccountStatus) => {
    setStatus((prev) =>
      prev ? { ...prev, accounts: prev.accounts.map((a) => (a.address === address ? updated : a)) } : prev,
    );
  };

  const { movingUids, deletingUids, folderMenuKey, foldersByAccount, confirmDeleteKey, toggleFolderMenu, moveMessage, handleTrashClick } =
    useMailRowActions({ limit: FULL_LIMIT, updateAccount, onError: setError });

  const markRead = async (address: string, uid: number) => {
    const k = `${address}:${uid}`;
    setMarkingUids((prev) => new Set(prev).add(k));
    try {
      const updated = await api.markMailRead(address, [uid], FULL_LIMIT);
      updateAccount(address, updated);
    } catch {
      setError("Couldn't mark that as read — try again.");
    } finally {
      setMarkingUids((prev) => {
        const copy = new Set(prev);
        copy.delete(k);
        return copy;
      });
    }
  };

  const markSenderRead = async (address: string, fromAddress: string) => {
    const key = `${address}:${fromAddress}`;
    setMarkingSenders((prev) => new Set(prev).add(key));
    try {
      const updated = await api.markSenderRead(address, fromAddress, FULL_LIMIT);
      updateAccount(address, updated);
    } catch {
      setError("Couldn't mark that sender as read — try again.");
    } finally {
      setMarkingSenders((prev) => {
        const copy = new Set(prev);
        copy.delete(key);
        return copy;
      });
    }
  };

  const markAllRead = async (address: string) => {
    const account = status?.accounts.find((a) => a.address === address);
    const total = account?.count ?? 0;
    if (!confirm(`Mark all ${total.toLocaleString()} unread messages in ${address} as read? This can't be undone from here.`)) {
      return;
    }
    setMarkingAllAccounts((prev) => new Set(prev).add(address));
    try {
      const updated = await api.markAllRead(address, FULL_LIMIT);
      updateAccount(address, updated);
    } catch {
      setError("Couldn't mark everything as read — try again.");
    } finally {
      setMarkingAllAccounts((prev) => {
        const copy = new Set(prev);
        copy.delete(address);
        return copy;
      });
    }
  };

  const refreshAccount = async (address: string) => {
    setRefreshingAccounts((prev) => new Set(prev).add(address));
    try {
      const updated = await api.refreshMailAccount(address, FULL_LIMIT);
      updateAccount(address, updated);
    } catch {
      setError("Couldn't refresh that account — try again.");
    } finally {
      setRefreshingAccounts((prev) => {
        const copy = new Set(prev);
        copy.delete(address);
        return copy;
      });
    }
  };

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-slate-100">Mail</h1>
      <div className="mb-4 text-sm text-slate-500">Unread across every Gmail account configured for this dashboard.</div>

      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {!status && !error && <div className="text-sm text-slate-500">Loading…</div>}

      {status && !status.configured && (
        <div className="text-sm text-slate-500">
          No Gmail accounts configured — set GMAIL_ADDRESS/GMAIL_APP_PASSWORD (and _2, _3, ...) in docker-compose.yml.
        </div>
      )}

      {status && status.configured && (
        <MailRulesPanel accountAddresses={status.accounts.map((a) => a.address)} />
      )}

      {status && status.configured && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {status.accounts.map((account) => (
            <AccountColumn
              key={account.address}
              account={account}
              refreshing={refreshingAccounts.has(account.address)}
              markingUids={markingUids}
              markingSenders={markingSenders}
              markingAll={markingAllAccounts.has(account.address)}
              movingUids={movingUids}
              deletingUids={deletingUids}
              folderMenuKey={folderMenuKey}
              folders={foldersByAccount[account.address]}
              confirmDeleteKey={confirmDeleteKey}
              onRefresh={refreshAccount}
              onMarkRead={markRead}
              onMarkSenderRead={markSenderRead}
              onMarkAllRead={markAllRead}
              onPreview={(address, uid) => setPreview({ address, uid })}
              onToggleFolderMenu={toggleFolderMenu}
              onMove={moveMessage}
              onTrashClick={handleTrashClick}
            />
          ))}
        </div>
      )}

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
