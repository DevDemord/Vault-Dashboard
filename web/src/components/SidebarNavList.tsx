import {
  CheckSquare,
  BookmarkSimple,
  ShareNetwork,
  CalendarBlank,
  Tray,
  PuzzlePiece,
  Copy,
  ImageBroken,
  ChartBar,
  Desktop,
  Gear,
  Folders,
} from '@phosphor-icons/react';
import type { DeadAttachment, NoteSummary, TagCount } from '../types';
import { FolderTree } from './FolderTree';
import { TagList } from './TagList';

export type NavKind =
  | 'home'
  | 'note'
  | 'tasks'
  | 'bookmarks'
  | 'graph'
  | 'calendar'
  | 'orphans'
  | 'stats'
  | 'inbox'
  | 'duplicates'
  | 'deadAttachments'
  | 'specs'
  | 'mail'
  | 'explorer';

/** Small uppercase divider label grouping related nav rows — purely visual, so a wall of a dozen
 * identical-looking buttons reads as three short, scannable clusters instead. */
function GroupLabel({ children }: { children: string }) {
  return <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{children}</div>;
}

/**
 * The nav button list + folder tree + tag list that make up the sidebar's content — shared
 * between the always-visible desktop `<aside>` and the mobile "Menu" sheet (opened from the
 * bottom tab bar below the `md` breakpoint, where there's no room for a persistent sidebar).
 * Each caller supplies its own chrome (header, close button, scroll container sizing); this is
 * just the three sections in between.
 */
export function SidebarNavList({
  activeKind,
  activePath,
  openTaskCount,
  openBookmarkCount,
  inboxCount,
  orphansCount,
  duplicatesCount,
  deadAttachmentsCount,
  onNavigate,
  onSettings,
  notes,
  attachmentFiles,
  tags,
  activeTag,
  onSelectTag,
  onSelectNote,
  showTags = true,
}: {
  activeKind: NavKind;
  activePath: string | null;
  openTaskCount: number;
  openBookmarkCount: number;
  inboxCount: number;
  orphansCount: number;
  duplicatesCount: number;
  deadAttachmentsCount: number;
  onNavigate: (kind: Exclude<NavKind, 'note'>) => void;
  onSettings: () => void;
  notes: NoteSummary[];
  attachmentFiles: DeadAttachment[];
  tags: TagCount[];
  activeTag: string | null;
  onSelectTag: (tag: string | null) => void;
  onSelectNote: (relPath: string) => void;
  /** The mobile "Menu" sheet hides the tag cloud — it's a lot of low-value clutter on a small
   * screen compared to the sidebar, where there's vertical room to spare. Defaults on for the
   * desktop sidebar. */
  showTags?: boolean;
}) {
  // `muted` dims an idle maintenance row (nothing to triage right now) so visual weight tracks
  // actual relevance instead of every row competing equally — full color returns the moment it
  // has something to show, or while it's the active view.
  const navClass = (kind: NavKind, muted = false) =>
    `flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-all ${
      activeKind === kind
        ? 'bg-violet-500/15 text-violet-300 shadow-inner shadow-violet-900/30'
        : muted
          ? 'text-slate-500 hover:translate-x-0.5 hover:bg-slate-800/60 hover:text-slate-300'
          : 'text-slate-300 hover:translate-x-0.5 hover:bg-slate-800/60'
    }`;

  const Badge = ({ count }: { count: number }) =>
    count > 0 ? (
      <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">{count}</span>
    ) : null;

  return (
    <>
      <div className="border-b border-slate-800/80 p-2">
        <GroupLabel>Workspace</GroupLabel>
        <button onClick={() => onNavigate('tasks')} className={navClass('tasks')} aria-label="Tasks">
          <span className="flex items-center gap-2.5">
            <CheckSquare size={17} weight="regular" />
            Tasks
          </span>
          <Badge count={openTaskCount} />
        </button>
        <button onClick={() => onNavigate('bookmarks')} className={navClass('bookmarks')} aria-label="Bookmarks">
          <span className="flex items-center gap-2.5">
            <BookmarkSimple size={17} weight="regular" />
            Bookmarks
          </span>
          <Badge count={openBookmarkCount} />
        </button>
        <button onClick={() => onNavigate('calendar')} className={navClass('calendar')} aria-label="Calendar">
          <span className="flex items-center gap-2.5">
            <CalendarBlank size={17} weight="regular" />
            Calendar
          </span>
        </button>
        <button onClick={() => onNavigate('graph')} className={navClass('graph')} aria-label="Graph">
          <span className="flex items-center gap-2.5">
            <ShareNetwork size={17} weight="regular" />
            Graph
          </span>
        </button>
        <button onClick={() => onNavigate('explorer')} className={navClass('explorer')} aria-label="Explorer">
          <span className="flex items-center gap-2.5">
            <Folders size={17} weight="regular" />
            Explorer
          </span>
        </button>

        <GroupLabel>Vault health</GroupLabel>
        <button
          onClick={() => onNavigate('inbox')}
          className={navClass('inbox', inboxCount === 0)}
          aria-label="Inbox triage"
        >
          <span className="flex items-center gap-2.5">
            <Tray size={17} weight="regular" />
            Inbox triage
          </span>
          <Badge count={inboxCount} />
        </button>
        <button
          onClick={() => onNavigate('orphans')}
          className={navClass('orphans', orphansCount === 0)}
          aria-label="Orphaned notes"
        >
          <span className="flex items-center gap-2.5">
            <PuzzlePiece size={17} weight="regular" />
            Orphans
          </span>
          <Badge count={orphansCount} />
        </button>
        <button
          onClick={() => onNavigate('duplicates')}
          className={navClass('duplicates', duplicatesCount === 0)}
          aria-label="Possible duplicates"
        >
          <span className="flex items-center gap-2.5">
            <Copy size={17} weight="regular" />
            Duplicates
          </span>
          <Badge count={duplicatesCount} />
        </button>
        <button
          onClick={() => onNavigate('deadAttachments')}
          className={navClass('deadAttachments', deadAttachmentsCount === 0)}
          aria-label="Dead attachments"
        >
          <span className="flex items-center gap-2.5">
            <ImageBroken size={17} weight="regular" />
            Dead attachments
          </span>
          <Badge count={deadAttachmentsCount} />
        </button>

        <GroupLabel>System</GroupLabel>
        <button onClick={() => onNavigate('stats')} className={navClass('stats')} aria-label="Vault activity">
          <span className="flex items-center gap-2.5">
            <ChartBar size={17} weight="regular" />
            Activity
          </span>
        </button>
        <button onClick={() => onNavigate('specs')} className={navClass('specs')} aria-label="Server">
          <span className="flex items-center gap-2.5">
            <Desktop size={17} weight="regular" />
            Server
          </span>
        </button>
        <button
          onClick={onSettings}
          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-slate-300 transition-all hover:translate-x-0.5 hover:bg-slate-800/60"
          aria-label="Settings"
        >
          <span className="flex items-center gap-2.5">
            <Gear size={17} weight="regular" />
            Settings
          </span>
        </button>
      </div>

      <div className="scroll-pane min-h-0 flex-1 overflow-y-auto">
        <FolderTree notes={notes} attachments={attachmentFiles} activePath={activePath} onSelect={onSelectNote} />
      </div>

      {showTags && (
        <div className="scroll-pane max-h-48 flex-shrink-0 overflow-y-auto border-t border-slate-800/80">
          <TagList tags={tags} activeTag={activeTag} onSelect={onSelectTag} />
        </div>
      )}
    </>
  );
}
