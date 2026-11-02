import { useEffect, useState } from 'react';
import { api } from '../api';
import { MAIL_LIMIT } from '../mailConstants';
import type { MailStatus } from '../types';

const POLL_MS = 60_000;

/**
 * Self-contained unread-Gmail pill: polls `/api/mail/unread` itself (no App.tsx wiring needed)
 * and renders nothing at all if the server has no Gmail accounts configured — so it's silently
 * absent for anyone who hasn't set GMAIL_ADDRESS/GMAIL_APP_PASSWORD, rather than showing an
 * error. Just a count + navigation trigger; the actual per-account message lists and mark-read
 * actions live on the full `MailView` page `onOpen` navigates to, not in a dropdown here.
 */
export function GmailWidget({ onOpen }: { onOpen: () => void }) {
  const [status, setStatus] = useState<MailStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      // Polls with the Mail page's own limit (not a smaller default) so this pill's regular
      // background poll keeps that exact cache entry warm — clicking through then hits a cache
      // hit instead of paying for a fresh IMAP fetch across every account.
      api
        .mailUnread(MAIL_LIMIT)
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {
          // Transient network hiccup — keep showing the last good status rather than flashing
          // an error state on every missed poll.
        });
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!status || !status.configured || status.accounts.length === 0) return null;

  const totalCount = status.accounts.reduce((sum, a) => sum + a.count, 0);
  const anyError = status.accounts.some((a) => a.error);

  return (
    <button
      onClick={onOpen}
      title={status.accounts.filter((a) => a.error).map((a) => `${a.address}: ${a.error}`).join('\n') || undefined}
      className="flex flex-shrink-0 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition hover:border-violet-500/40"
    >
      <span className="flex-shrink-0">{anyError ? '⚠️' : '📧'}</span>
      <span className="truncate">{totalCount === 0 ? 'Inbox zero' : `${totalCount} unread`}</span>
    </button>
  );
}
