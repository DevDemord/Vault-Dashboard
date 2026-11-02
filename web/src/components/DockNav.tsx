import { useEffect, useState } from 'react';
import {
  SquaresFour,
  House,
  CheckSquare,
  EnvelopeSimple,
  NotePencil,
  ChartBar,
  Folders,
  BookmarkSimple,
  CalendarBlank,
  ShareNetwork,
  Tray,
  PuzzlePiece,
  Copy,
  ImageBroken,
  Desktop,
} from '@phosphor-icons/react';
import { api } from '../api';
import { MAIL_LIMIT } from '../mailConstants';

/** The dock's own primary destinations — a subset of `App.tsx`'s `View['kind']` (never `'note'`:
 * there's no single "the notes view" to point at, just whatever note happens to be open). */
export type DockKind =
  | 'home'
  | 'tasks'
  | 'mail'
  | 'stats'
  | 'explorer'
  | 'bookmarks'
  | 'calendar'
  | 'graph'
  | 'inbox'
  | 'orphans'
  | 'duplicates'
  | 'deadAttachments'
  | 'specs';

const POLL_MS = 60_000;

/**
 * A floating glass "app dock" — an alternative, icon-only quick-nav that sits over the page on
 * desktop, alongside the existing left sidebar rather than replacing it (prototyped first as an
 * Artifact mockup at the user's request, 2026-10-26). Same active-state treatment as the
 * sidebar's own collapsed rail (`bg-violet-500/20 text-violet-300`) and the same Phosphor icons
 * for any destination the sidebar already has one for, so the two navs read as one system.
 *
 * Primary row: Home, Tasks, Mail, Today's Note, Stats, Explorer, Bookmarks — the leftmost grid
 * icon opens an overflow panel for everything else the sidebar offers (Calendar, Graph, Inbox,
 * Orphans, Duplicates, Dead attachments, Specs). Self-polls unread mail like `GmailWidget` does
 * (same `/api/mail/unread` cache key via `MAIL_LIMIT`) rather than threading a count down from
 * `App.tsx`, so it stays a drop-in component.
 */
export function DockNav({
  activeKind,
  openTaskCount,
  inboxCount,
  orphansCount,
  duplicatesCount,
  deadAttachmentsCount,
  onNavigate,
  onOpenToday,
}: {
  activeKind: DockKind | 'note';
  openTaskCount: number;
  inboxCount: number;
  orphansCount: number;
  duplicatesCount: number;
  deadAttachmentsCount: number;
  onNavigate: (kind: DockKind) => void;
  onOpenToday: () => void;
}) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [mailUnread, setMailUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .mailUnread(MAIL_LIMIT)
        .then((status) => {
          if (cancelled || !status.configured) return;
          setMailUnread(status.accounts.reduce((sum, a) => sum + a.count, 0));
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

  const btnClass = (active: boolean) =>
    `relative flex h-8 w-8 items-center justify-center rounded-full transition ${
      active ? 'bg-violet-500/20 text-violet-300' : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
    }`;

  const Badge = ({ count }: { count: number }) =>
    count > 0 ? (
      <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-violet-600 px-0.5 text-[9px] font-medium text-white">
        {count}
      </span>
    ) : null;

  const navigate = (kind: DockKind) => {
    onNavigate(kind);
    setOverflowOpen(false);
  };

  const overflowItems: { kind: DockKind; label: string; icon: JSX.Element; count?: number }[] = [
    { kind: 'calendar', label: 'Calendar', icon: <CalendarBlank size={16} weight="regular" /> },
    { kind: 'graph', label: 'Graph', icon: <ShareNetwork size={16} weight="regular" /> },
    { kind: 'inbox', label: 'Inbox', icon: <Tray size={16} weight="regular" />, count: inboxCount },
    { kind: 'orphans', label: 'Orphans', icon: <PuzzlePiece size={16} weight="regular" />, count: orphansCount },
    { kind: 'duplicates', label: 'Duplicates', icon: <Copy size={16} weight="regular" />, count: duplicatesCount },
    {
      kind: 'deadAttachments',
      label: 'Dead files',
      icon: <ImageBroken size={16} weight="regular" />,
      count: deadAttachmentsCount,
    },
    { kind: 'specs', label: 'Specs', icon: <Desktop size={16} weight="regular" /> },
  ];

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 hidden flex-col items-center gap-2 print:hidden md:flex">
      {overflowOpen && (
        <>
          <button
            className="pointer-events-auto fixed inset-0 z-[39] cursor-default"
            aria-label="Close menu"
            onClick={() => setOverflowOpen(false)}
          />
          <div className="pointer-events-auto grid w-[300px] grid-cols-4 gap-1 rounded-2xl border border-slate-700/60 bg-slate-950/85 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl">
            {overflowItems.map((item) => (
              <button
                key={item.kind}
                onClick={() => navigate(item.kind)}
                title={item.label}
                className={`relative flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium transition ${
                  activeKind === item.kind
                    ? 'bg-violet-500/20 text-violet-300'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                }`}
              >
                {item.icon}
                {item.label}
                {item.count !== undefined && <Badge count={item.count} />}
              </button>
            ))}
          </div>
        </>
      )}

      <nav
        aria-label="Quick nav"
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-slate-700/60 bg-slate-950/70 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl"
      >
        <button
          onClick={() => setOverflowOpen((v) => !v)}
          title="More views"
          aria-label="More views"
          className={btnClass(overflowOpen)}
        >
          <SquaresFour size={16} weight="regular" />
        </button>

        <div className="mx-1 h-5 w-px bg-slate-700/60" />

        <button onClick={() => navigate('home')} title="Home" aria-label="Home" className={btnClass(activeKind === 'home')}>
          <House size={16} weight="regular" />
        </button>

        <button
          onClick={() => navigate('tasks')}
          title="Tasks"
          aria-label="Tasks"
          className={btnClass(activeKind === 'tasks')}
        >
          <CheckSquare size={16} weight="regular" />
          <Badge count={openTaskCount} />
        </button>

        <button onClick={() => navigate('mail')} title="Mail" aria-label="Mail" className={btnClass(activeKind === 'mail')}>
          <EnvelopeSimple size={16} weight="regular" />
          <Badge count={mailUnread} />
        </button>

        <button onClick={onOpenToday} title="Today's Note" aria-label="Today's Note" className={btnClass(false)}>
          <NotePencil size={16} weight="regular" />
        </button>

        <button
          onClick={() => navigate('stats')}
          title="Vault activity"
          aria-label="Vault activity"
          className={btnClass(activeKind === 'stats')}
        >
          <ChartBar size={16} weight="regular" />
        </button>

        <button
          onClick={() => navigate('explorer')}
          title="Explorer"
          aria-label="Explorer"
          className={btnClass(activeKind === 'explorer')}
        >
          <Folders size={16} weight="regular" />
        </button>

        <button
          onClick={() => navigate('bookmarks')}
          title="Bookmarks"
          aria-label="Bookmarks"
          className={btnClass(activeKind === 'bookmarks')}
        >
          <BookmarkSimple size={16} weight="regular" />
        </button>
      </nav>
    </div>
  );
}
