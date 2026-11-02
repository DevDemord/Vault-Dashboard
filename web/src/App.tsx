import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CaretDoubleRight,
  CaretDoubleLeft,
  ArrowsClockwise,
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
  FolderOpen,
  Folders,
} from '@phosphor-icons/react';
import { api, ApiError } from './api';
import type {
  BookmarkItem,
  ChecklistItem,
  DeadAttachment,
  DuplicatePair,
  NoteDetail,
  NoteSummary,
  SportsEvent,
  Stats,
  TagCount,
} from './types';
import { SearchBox } from './components/SearchBox';
import { AddBookmarkBox } from './components/AddBookmarkBox';
import { SidebarNavList } from './components/SidebarNavList';
import { NoteView, type NoteViewHandle } from './components/NoteView';
import { TasksView } from './components/TasksView';
import { TasksQuickView } from './components/TasksQuickView';
import { GmailWidget } from './components/GmailWidget';
import { MailView } from './components/MailView';
import { SystemSpecsView } from './components/SystemSpecsView';
import { ExplorerView } from './components/ExplorerView';
import { BookmarksView } from './components/BookmarksView';
import { NewNoteModal } from './components/NewNoteModal';
import { CalloutSettingsModal } from './components/CalloutSettingsModal';
import { QuickLinksPanel } from './components/QuickLinksPanel';
import { GraphView } from './components/GraphView';
import { CalendarView } from './components/CalendarView';
import { ReadingWidthControl } from './components/ReadingWidthControl';
import { OrphansView } from './components/OrphansView';
import { StatsView } from './components/StatsView';
import { InboxTriageView } from './components/InboxTriageView';
import { DuplicatesView } from './components/DuplicatesView';
import { DeadAttachmentsView } from './components/DeadAttachmentsView';
import { ToastStack, type ToastMessage } from './components/Toast';
import { OutlineRail } from './components/OutlineRail';
import { FolderNotesModal } from './components/FolderNotesModal';
import { HomeDashboard } from './components/HomeDashboard';
import { todayDateString } from './components/TodayNote';
import { DockNav, type DockKind } from './components/DockNav';
import { extractOutline } from './components/outline';
import { colorForFolder, topFolder } from './components/folderColors';

const INBOX_FOLDER = '1. Inbox';
const DAILY_FOLDER = '6. Daily';

/** Excluded from the home page's "Recently edited" list, same reasoning `vault.ts`'s
 * `getStats()` applies to "Last edited": the two `_Templates` files are written to by
 * background automation (the Trending poller touches its one every few minutes regardless of
 * anything the user does) rather than by actually editing the vault, and daily notes — while
 * genuinely user-written — are a running scratchpad touched so often they'd otherwise dominate
 * this list over whatever the user actually meant to work on. */
const RECENT_NOTES_EXCLUDED_FILES = new Set(['_Templates/trending-feed.md', '_Templates/claude-activity-log.md']);

type View =
  | { kind: 'home' }
  | { kind: 'note'; path: string }
  | { kind: 'tasks' }
  | { kind: 'bookmarks' }
  | { kind: 'graph' }
  | { kind: 'calendar' }
  | { kind: 'orphans' }
  | { kind: 'stats' }
  | { kind: 'inbox' }
  | { kind: 'duplicates' }
  | { kind: 'deadAttachments' }
  | { kind: 'mail' }
  | { kind: 'specs' }
  | { kind: 'explorer' };

type SplitSide = 'left' | 'right';
type SplitPaneView = { kind: 'home' } | { kind: 'note'; path: string };

const DEFAULT_NOTE_WIDTH_REM = 57.6;

const NOTE_URL_PARAM = 'note';
const EDIT_URL_PARAM = 'edit';

/** Reads the `?note=`/`&edit=1` query params an effect below keeps in sync with `view` and
 * `activeNoteEditing` — this app has no router, so without this, a plain page reload (or just
 * clicking the browser's own refresh button) always restarted at the home dashboard, with no
 * way to tell it to land back on whatever note you were reading or editing instead. */
function readNoteFromUrl(): { path: string; edit: boolean } | null {
  const params = new URLSearchParams(window.location.search);
  const path = params.get(NOTE_URL_PARAM);
  if (!path) return null;
  return { path, edit: params.get(EDIT_URL_PARAM) === '1' };
}

export default function App() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tasks, setTasks] = useState<ChecklistItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [sportsEvents, setSportsEvents] = useState<SportsEvent[]>([]);
  const [view, setView] = useState<View>(() => {
    const fromUrl = readNoteFromUrl();
    return fromUrl ? { kind: 'note', path: fromUrl.path } : { kind: 'home' };
  });
  const [activeNote, setActiveNote] = useState<NoteDetail | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const selectTag = (tag: string | null) => {
    setActiveTag(tag);
  };
  // Which top-level PARA folder's file-picker modal is open (or null) — clicking a folder icon
  // never touches the home page's "Recently edited" list, it just opens this modal on top of it.
  const [folderModal, setFolderModal] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  // Editing wants the full width, not the reading-width-slider's comfortable-prose cap — lifted
  // up from NoteView (which owns the actual `editing` state) just far enough to adjust the
  // content column's own max-width below.
  const [activeNoteEditing, setActiveNoteEditing] = useState(false);
  const noteViewRef = useRef<NoteViewHandle>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showNewNote, setShowNewNote] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [calloutIcons, setCalloutIcons] = useState<Record<string, string>>({});
  const [calloutColors, setCalloutColors] = useState<Record<string, string>>({});
  const [statColors, setStatColors] = useState<Record<string, string>>({});
  const [sportColors, setSportColors] = useState<Record<string, string>>({});
  const [sportImages, setSportImages] = useState<Record<string, string>>({});
  const [videoVolume, setVideoVolume] = useState(1);
  const [homeMode, setHomeMode] = useState<'personal' | 'work'>('personal');
  const [siteIcon, setSiteIcon] = useState<string | null>(null);
  const noteScrollRef = useRef<HTMLDivElement>(null);
  const [activeHeadingSlug, setActiveHeadingSlug] = useState<string | null>(null);
  // Which just-created note (if any) should open straight into editing instead of the read view —
  // cleared the instant NoteView consumes it, so navigating back to that same note later doesn't
  // auto-edit it again. Also doubles as the mechanism for restoring edit mode after a reload
  // (see `readNoteFromUrl`): the same one-shot "open straight into editing" behavior applies
  // either way, so there's no need for a second flag.
  const [autoEditPath, setAutoEditPath] = useState<string | null>(() => {
    const fromUrl = readNoteFromUrl();
    return fromUrl?.edit ? fromUrl.path : null;
  });
  const [orphans, setOrphans] = useState<NoteSummary[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);
  const [deadAttachments, setDeadAttachments] = useState<DeadAttachment[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<DeadAttachment[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [splitActive, setSplitActive] = useState(false);
  const [primarySide, setPrimarySide] = useState<SplitSide>('left');
  const [splitView, setSplitView] = useState<SplitPaneView>({ kind: 'home' });
  const [splitNote, setSplitNote] = useState<NoteDetail | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [closedTabs, setClosedTabs] = useState<string[]>([]);
  const [dragTabIndex, setDragTabIndex] = useState<number | null>(null);
  const [noteWidthRem, setNoteWidthRem] = useState<number>(DEFAULT_NOTE_WIDTH_REM);

  const goTo = (v: View) => setView(v);
  const navigateToNote = (relPath: string) => setView({ kind: 'note', path: relPath });

  // A handful of background operations (settings autosave, task toggling, archive/delete) used
  // to fail completely silently — no visible indication anything went wrong. This is the one
  // place that now surfaces those failures; everything else keeps its own existing error UI.
  const pushToast = (text: string, kind: ToastMessage['kind'] = 'error') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  };
  const dismissToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const handleArchive = async (relPath: string) => {
    if (!confirm('Move this note to 5. Archive?')) return;
    try {
      await api.archiveNote(relPath);
      setOpenTabs((prev) => prev.filter((p) => p !== relPath));
      goTo({ kind: 'home' });
      refresh();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not archive this note.');
    }
  };

  const handleDelete = async (relPath: string) => {
    if (!confirm('Delete this note? It will be moved to the vault\'s .trash folder (same as Obsidian\'s own delete), not permanently erased.')) return;
    try {
      await api.deleteNote(relPath);
      setOpenTabs((prev) => prev.filter((p) => p !== relPath));
      goTo({ kind: 'home' });
      refresh();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not delete this note.');
    }
  };

  const closeTab = (relPath: string) => {
    const idx = openTabs.indexOf(relPath);
    const next = openTabs.filter((p) => p !== relPath);
    setOpenTabs(next);
    setClosedTabs((prev) => [...prev, relPath].slice(-10));
    if (view.kind === 'note' && view.path === relPath) {
      const fallback = next[idx] ?? next[idx - 1];
      goTo(fallback ? { kind: 'note', path: fallback } : { kind: 'home' });
    }
  };

  const reopenLastClosedTab = () => {
    if (closedTabs.length === 0) return;
    const path = closedTabs[closedTabs.length - 1];
    setClosedTabs((prev) => prev.slice(0, -1));
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    navigateToNote(path);
  };

  const reorderTabs = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setOpenTabs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleSplitArchive = async (relPath: string) => {
    if (!confirm('Move this note to 5. Archive?')) return;
    try {
      await api.archiveNote(relPath);
      setOpenTabs((prev) => prev.filter((p) => p !== relPath));
      setSplitView({ kind: 'home' });
      refresh();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not archive this note.');
    }
  };

  const handleSplitDelete = async (relPath: string) => {
    if (!confirm('Delete this note? It will be moved to the vault\'s .trash folder (same as Obsidian\'s own delete), not permanently erased.')) return;
    try {
      await api.deleteNote(relPath);
      setOpenTabs((prev) => prev.filter((p) => p !== relPath));
      setSplitView({ kind: 'home' });
      refresh();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not delete this note.');
    }
  };

  const toggleTask = async (item: ChecklistItem, done: boolean) => {
    const match = (t: ChecklistItem) => t.sourcePath === item.sourcePath && t.line === item.line;
    setTasks((prev) => prev.map((t) => (match(t) ? { ...t, done } : t)));
    try {
      await api.toggleTask(item.sourcePath, item.line, done);
    } catch {
      setTasks((prev) => prev.map((t) => (match(t) ? { ...t, done: !done } : t)));
      pushToast('Could not save that change — the checkbox has been reverted.');
    }
  };

  const addTask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await api.addTask(trimmed);
      refresh();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not add that task.');
    }
  };

  const addBookmark = async (url: string) => {
    try {
      await api.addBookmark(url);
      refresh();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not save that bookmark.');
      throw err; // keeps the typed URL in AddBookmarkBox instead of clearing it on failure
    }
  };

  const refresh = () => {
    Promise.all([
      api.notes(),
      api.tags(),
      api.stats(),
      api.tasks(),
      api.bookmarks(),
      api.orphans(),
      api.duplicates(),
      api.deadAttachments(),
      api.attachmentFiles(),
      api.allSportsEvents(),
    ])
      .then(([n, t, s, tk, bm, orp, dup, dead, files, events]) => {
        setNotes(n);
        setTags(t);
        setStats(s);
        setTasks(tk);
        setBookmarks(bm);
        setOrphans(orp);
        setDuplicates(dup);
        setDeadAttachments(dead);
        setAttachmentFiles(files);
        setSportsEvents(events);
        setLoadError(null);
      })
      .catch(() => setLoadError('Could not reach the vault server.'));
  };

  // DockNav's "Today's Note" quick action — same `getOrCreateDaily` call TodayNote.tsx itself
  // makes on mount, so clicking it from anywhere jumps straight to (or creates) today's daily
  // note rather than just navigating to a path that might not exist yet.
  const openTodayNote = () => {
    api
      .getOrCreateDaily(todayDateString())
      .then((note) => {
        navigateToNote(note.relPath);
        refresh();
      })
      .catch(() => pushToast("Could not open today's note."));
  };

  useEffect(() => {
    refresh();
  }, []);

  // The vault's own files can change from outside this browser tab entirely — another device
  // editing a note that syncs in underneath this one, or the dashboard open in two tabs at
  // once — and nothing pushes that back to an already-open tab on its own. Without this, stats
  // like "Last edited" only ever update after something inside *this* tab happens to call
  // `refresh()` itself, so a note edited elsewhere could sit there looking stale indefinitely
  // even though the server already has the right answer the moment you ask it.
  useEffect(() => {
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Loaded once on mount — the three effects below are guarded on `settingsLoaded` so that the
  // `false`/`[]`/default state this component starts with (before this fetch resolves) never
  // gets PATCHed to the server and clobbers whatever was actually saved there.
  useEffect(() => {
    api
      .getSettings()
      .then((settings) => {
        setSidebarCollapsed(settings.sidebarCollapsed);
        setOpenTabs(settings.openTabs);
        setNoteWidthRem(settings.noteWidthRem);
        setCalloutIcons(settings.calloutIcons ?? {});
        setCalloutColors(settings.calloutColors ?? {});
        setStatColors(settings.statColors ?? {});
        setSportColors(settings.sportColors ?? {});
        setSportImages(settings.sportImages ?? {});
        setVideoVolume(settings.videoVolume ?? 1);
        setHomeMode(settings.homeMode ?? 'personal');
        setSiteIcon(settings.siteIcon ?? null);
      })
      .catch(() => {
        // keep defaults — settingsLoaded still flips below so future changes persist normally
      })
      .finally(() => setSettingsLoaded(true));
  }, []);

  // Keeps the actual browser-tab favicon (not just the collapsed sidebar's icon) in sync —
  // index.html's <link id="favicon-link"> starts pointed at the default /favicon.svg, and this
  // swaps it to the uploaded icon once settings load, or back to the default if removed.
  useEffect(() => {
    const old = document.getElementById('favicon-link') as HTMLLinkElement | null;
    // Some browsers (Chrome among them) ignore a plain `href` mutation on an existing <link
    // rel="icon">, so the old tag is removed and a fresh one inserted instead — the same
    // "force a refetch" trick as a cache-busting query string, just at the DOM level too.
    old?.remove();
    const link = document.createElement('link');
    link.id = 'favicon-link';
    link.rel = 'icon';
    if (siteIcon) {
      link.href = `/api/site-icon?v=${encodeURIComponent(siteIcon)}`;
    } else {
      link.type = 'image/svg+xml';
      link.href = '/favicon.svg';
    }
    document.head.appendChild(link);
  }, [siteIcon]);

  useEffect(() => {
    if (!settingsLoaded) return;
    api.updateSettings({ sidebarCollapsed }).catch(() => {
      // local state already updated; a failed save just means it won't persist this time
      pushToast("Couldn't save that — it may not stick after a reload.");
    });
  }, [sidebarCollapsed, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    api.updateSettings({ homeMode }).catch(() => {
      // local state already updated; a failed save just means it won't persist this time
      pushToast("Couldn't save that — it may not stick after a reload.");
    });
  }, [homeMode, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    api.updateSettings({ openTabs }).catch(() => {
      // local state already updated; a failed save just means it won't persist this time
      pushToast("Couldn't save your open tabs — they may not stick after a reload.");
    });
  }, [openTabs, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    // Debounced — the width slider fires onChange continuously while dragging, so only the value
    // the user settles on after a short pause actually gets written.
    const t = setTimeout(() => {
      api.updateSettings({ noteWidthRem }).catch(() => {
        // local state already updated; a failed save just means it won't persist this time
        pushToast("Couldn't save the reading width — it may not stick after a reload.");
      });
    }, 400);
    return () => clearTimeout(t);
  }, [noteWidthRem, settingsLoaded]);

  useEffect(() => {
    if (view.kind !== 'note') {
      setActiveNote(null);
      setSplitActive(false);
      setSplitView({ kind: 'home' });
      setZenMode(false);
      setActiveNoteEditing(false);
      return;
    }
    api.note(view.path).then(setActiveNote).catch(() => setActiveNote(null));
    setOpenTabs((prev) => (prev.includes(view.path) ? prev : [...prev, view.path]));
  }, [view]);

  // Browser/mouse "back" has no router to intercept here, so we fake just enough history for it
  // to feel right: pushing one entry the moment we leave the dashboard means the back button's
  // first press always lands back on it, matching the in-app "Back to dashboard" buttons exactly
  // (same `goTo({ kind: 'home' })` target) rather than navigating the tab away from the app.
  const prevViewKindRef = useRef<View['kind']>('home');
  useEffect(() => {
    const wasHome = prevViewKindRef.current === 'home';
    const isHome = view.kind === 'home';
    if (wasHome && !isHome) window.history.pushState({ vaultView: true }, '');
    prevViewKindRef.current = view.kind;
  }, [view.kind]);

  useEffect(() => {
    const onPopState = () => goTo({ kind: 'home' });
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Keeps the current note (and whether it's open for editing) mirrored into the URL's query
  // string, purely so `readNoteFromUrl` above has something to restore from on the next reload
  // — this never pushes a new history entry (that's the effect above's job, and it already
  // covers Back/Forward), it just corrects whichever entry is currently on top.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (view.kind === 'note') {
      params.set(NOTE_URL_PARAM, view.path);
      if (activeNoteEditing) params.set(EDIT_URL_PARAM, '1');
      else params.delete(EDIT_URL_PARAM);
    } else {
      params.delete(NOTE_URL_PARAM);
      params.delete(EDIT_URL_PARAM);
    }
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
    window.history.replaceState(window.history.state, '', url);
  }, [view, activeNoteEditing]);

  useEffect(() => {
    if (splitView.kind !== 'note') {
      setSplitNote(null);
      return;
    }
    api.note(splitView.path).then(setSplitNote).catch(() => setSplitNote(null));
  }, [splitView]);

  const startSplit = (side: SplitSide) => {
    setPrimarySide(side);
    setSplitView({ kind: 'home' });
    setSplitActive(true);
    setZenMode(false);
    setActiveNoteEditing(false);
  };

  /** What clicking a `[[wikilink]]` does everywhere now (the rendered body, Ctrl/Cmd+click in
   * the editor, Today's Note) — opens the target as a split pane on the right instead of
   * navigating away from whatever's currently on screen. The split layout only ever renders
   * when `view.kind === 'note'` (see the gate a few hundred lines down), so entering split from
   * the Home page means the clicked note becomes the new primary `view` and whatever was
   * already showing (a note, or Home/Today's Note) gets pushed into the secondary pane so it
   * stays visible, rather than just vanishing. */
  const openNoteInSplit = (relPath: string) => {
    if (splitActive && view.kind === 'note') {
      // Already split: leave the primary pane (and which side it's on) alone -- just retarget
      // the secondary pane, same as its own pre-existing link-click behavior already does.
      setSplitView({ kind: 'note', path: relPath });
      return;
    }
    setSplitView(view.kind === 'note' ? { kind: 'note', path: view.path } : { kind: 'home' });
    setPrimarySide('right');
    // Cleared up front, not left stale: the split layout's gate below requires `activeNote`
    // truthy, and without this it'd stay the OLD note (the one just pushed into `splitView`)
    // until the `[view]` effect's async fetch resolves — a flash of the same note rendered in
    // both panes before the right side swaps to the real target a moment later. Clearing it
    // keeps the single-pane view showing (same "loading" gap as any other navigation) until the
    // new note is actually ready, so the split layout only ever appears already correct.
    setActiveNote(null);
    setView({ kind: 'note', path: relPath });
    setSplitActive(true);
    setZenMode(false);
    setActiveNoteEditing(false);
  };

  const closeSplit = () => {
    setSplitActive(false);
    setSplitView({ kind: 'home' });
  };

  const visibleNotes = useMemo(() => {
    if (activeTag) return notes.filter((n) => n.tags.includes(activeTag));
    return notes;
  }, [notes, activeTag]);

  // Top-level folders for the collapsed sidebar's per-folder icons — underscore-prefixed system
  // folders (_Attachments, _Templates, _Scripts) are deliberately excluded, since those aren't
  // something the user browses by clicking a folder icon the way the PARA folders are.
  const sidebarFolders = useMemo(() => {
    const names = [...new Set(notes.map((n) => topFolder(n.folder)))].filter((f) => !f.startsWith('_'));
    return names.sort();
  }, [notes]);
  const folderColorOrder = useMemo(
    () => [...new Set(notes.map((n) => topFolder(n.folder)))].sort(),
    [notes],
  );

  // `notes` is already sorted newest-mtime-first (see `VaultIndex.listNotes`), so this is just
  // the top of that list minus the excluded files/folder above — vault-wide, not folder-scoped;
  // it used to only show notes under "4. Resources", which hid an Inbox note (or anything else
  // outside Resources) you'd just edited even though it really was the most recent thing touched.
  const recentNotes = useMemo(
    () => notes.filter((n) => !RECENT_NOTES_EXCLUDED_FILES.has(n.relPath) && n.folder !== DAILY_FOLDER).slice(0, 8),
    [notes],
  );
  const inboxNotes = useMemo(() => notes.filter((n) => n.folder === INBOX_FOLDER), [notes]);
  const noteOutline = useMemo(() => (activeNote ? extractOutline(activeNote.renderedBody) : []), [activeNote]);

  // Scroll-spy for the outline rail: track which heading the reader is currently at, so the rail
  // can highlight it instead of only reacting to clicks. Reads heading positions straight off the
  // DOM (ids assigned by NoteView's headingComponent) rather than re-deriving them, since those ids
  // are the same ones jumpTo() already targets.
  useEffect(() => {
    if (view.kind !== 'note' || !activeNote || noteOutline.length < 2) {
      setActiveHeadingSlug(null);
      return;
    }
    const container = noteScrollRef.current;
    if (!container) return;

    const updateActive = () => {
      const threshold = container.getBoundingClientRect().top + 120;
      let current: string | null = noteOutline[0].slug;
      for (const h of noteOutline) {
        const el = document.getElementById(h.slug);
        if (el && el.getBoundingClientRect().top <= threshold) current = h.slug;
      }
      setActiveHeadingSlug(current);
    };

    updateActive();
    container.addEventListener('scroll', updateActive, { passive: true });
    return () => container.removeEventListener('scroll', updateActive);
  }, [view.kind, activeNote, noteOutline]);

  const openTaskCount = useMemo(() => tasks.filter((t) => !t.done).length, [tasks]);
  const openBookmarkCount = useMemo(() => bookmarks.filter((b) => !b.done).length, [bookmarks]);
  // Every distinct sport tag actually in use, for the Settings modal's "Sport colors" section —
  // lets it list real tags to color without the user having to retype them there.
  const knownSportTags = useMemo(
    () => [...new Set(sportsEvents.map((e) => e.sport).filter((s): s is string => s !== null))].sort(),
    [sportsEvents],
  );

  const contentMaxWidth =
    view.kind === 'graph' ||
    view.kind === 'home' ||
    view.kind === 'mail' ||
    view.kind === 'calendar' ||
    view.kind === 'explorer' ||
    (view.kind === 'note' && activeNoteEditing)
      ? 'max-w-none'
      : view.kind === 'note'
        ? ''
        : 'max-w-3xl';
  const contentMaxWidthStyle =
    view.kind === 'note' && !activeNoteEditing ? { maxWidth: `${noteWidthRem}rem` } : undefined;

  return (
    <div className="flex h-full flex-col md:flex-row">
      {!zenMode && (sidebarCollapsed ? (
        <aside className="scroll-pane relative hidden w-14 flex-shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-slate-800/80 bg-slate-950/60 py-3 print:hidden md:flex">
          <button
            onClick={() => setSidebarCollapsed(false)}
            title="Show sidebar"
            aria-label="Show sidebar"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
          >
            <CaretDoubleRight size={16} weight="bold" />
          </button>
          <button
            onClick={() => goTo({ kind: 'home' })}
            title="Vault — back to dashboard"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-display font-semibold text-white"
          >
            {siteIcon ? (
              <img
                src={`/api/site-icon?v=${encodeURIComponent(siteIcon)}`}
                alt="Vault"
                className="h-full w-full object-cover"
              />
            ) : (
              'V'
            )}
          </button>
          <div className="my-1 h-px w-8 bg-slate-800" />
          <button
            onClick={() => goTo({ kind: 'tasks' })}
            title="Tasks"
            aria-label="Tasks"
            className={`relative flex h-9 w-9 items-center justify-center rounded-full transition ${
              view.kind === 'tasks' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <CheckSquare size={18} weight="regular" />
            {openTaskCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-medium text-white">
                {openTaskCount}
              </span>
            )}
          </button>
          <button
            onClick={() => goTo({ kind: 'bookmarks' })}
            title="Bookmarks"
            aria-label="Bookmarks"
            className={`relative flex h-9 w-9 items-center justify-center rounded-full transition ${
              view.kind === 'bookmarks' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <BookmarkSimple size={18} weight="regular" />
            {openBookmarkCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-medium text-white">
                {openBookmarkCount}
              </span>
            )}
          </button>
          <button
            onClick={() => goTo({ kind: 'calendar' })}
            title="Calendar"
            aria-label="Calendar"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
              view.kind === 'calendar' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <CalendarBlank size={18} weight="regular" />
          </button>
          <button
            onClick={() => goTo({ kind: 'graph' })}
            title="Graph"
            aria-label="Graph"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
              view.kind === 'graph' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <ShareNetwork size={18} weight="regular" />
          </button>
          <button
            onClick={() => goTo({ kind: 'explorer' })}
            title="Explorer"
            aria-label="Explorer"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
              view.kind === 'explorer' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <Folders size={18} weight="regular" />
          </button>
          <div className="my-1 h-px w-8 bg-slate-800" />
          <button
            onClick={() => goTo({ kind: 'inbox' })}
            title="Inbox triage"
            aria-label="Inbox triage"
            className={`relative flex h-9 w-9 items-center justify-center rounded-full transition ${
              view.kind === 'inbox'
                ? 'bg-violet-500/20 text-violet-300'
                : inboxNotes.length === 0
                  ? 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
                  : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <Tray size={18} weight="regular" />
            {inboxNotes.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-medium text-white">
                {inboxNotes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => goTo({ kind: 'orphans' })}
            title="Orphaned notes"
            aria-label="Orphaned notes"
            className={`relative flex h-9 w-9 items-center justify-center rounded-full transition ${
              view.kind === 'orphans'
                ? 'bg-violet-500/20 text-violet-300'
                : orphans.length === 0
                  ? 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
                  : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <PuzzlePiece size={18} weight="regular" />
            {orphans.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-medium text-white">
                {orphans.length}
              </span>
            )}
          </button>
          <button
            onClick={() => goTo({ kind: 'duplicates' })}
            title="Possible duplicates"
            aria-label="Possible duplicates"
            className={`relative flex h-9 w-9 items-center justify-center rounded-full transition ${
              view.kind === 'duplicates'
                ? 'bg-violet-500/20 text-violet-300'
                : duplicates.length === 0
                  ? 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
                  : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <Copy size={18} weight="regular" />
            {duplicates.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-medium text-white">
                {duplicates.length}
              </span>
            )}
          </button>
          <button
            onClick={() => goTo({ kind: 'deadAttachments' })}
            title="Dead attachments"
            aria-label="Dead attachments"
            className={`relative flex h-9 w-9 items-center justify-center rounded-full transition ${
              view.kind === 'deadAttachments'
                ? 'bg-violet-500/20 text-violet-300'
                : deadAttachments.length === 0
                  ? 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
                  : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <ImageBroken size={18} weight="regular" />
            {deadAttachments.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-medium text-white">
                {deadAttachments.length}
              </span>
            )}
          </button>
          <button
            onClick={() => goTo({ kind: 'stats' })}
            title="Vault activity"
            aria-label="Vault activity"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
              view.kind === 'stats' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <ChartBar size={18} weight="regular" />
          </button>
          <div className="my-1 h-px w-8 bg-slate-800" />
          {/* One icon per top-level PARA folder — clicking one opens a modal to pick a file from
              it, without ever touching the home screen's "Recently edited" list. System folders
              (_Attachments etc.) are left out of `sidebarFolders`. */}
          {sidebarFolders.map((folder) => {
            const glyph = folder.match(/^(\d+)\./)?.[1] ?? folder.charAt(0).toUpperCase();
            return (
              <button
                key={folder}
                onClick={() => setFolderModal(folder)}
                title={folder}
                aria-label={folder}
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ${
                  folderModal === folder ? 'ring-2 ring-violet-400' : 'hover:brightness-110'
                }`}
                style={{
                  color: colorForFolder(folder, folderColorOrder),
                  backgroundColor: `${colorForFolder(folder, folderColorOrder)}22`,
                }}
              >
                {glyph}
              </button>
            );
          })}
          <button
            onClick={() => setSidebarCollapsed(false)}
            title="Expand sidebar for the full folder tree"
            aria-label="Expand sidebar for the full folder tree"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-800/60"
          >
            <FolderOpen size={18} weight="regular" />
          </button>

          <button
            onClick={() => goTo({ kind: 'specs' })}
            title="Server"
            aria-label="Server"
            className={`mt-auto flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition ${
              view.kind === 'specs' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <Desktop size={18} weight="regular" />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            aria-label="Settings"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-800/60"
          >
            <Gear size={18} weight="regular" />
          </button>
        </aside>
      ) : (
        <aside className="hidden w-72 flex-shrink-0 flex-col border-r border-slate-800/80 bg-slate-950/60 print:hidden md:flex">
          <div className="border-b border-slate-800/80 bg-slate-950/90 p-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => goTo({ kind: 'home' })}
                className="font-display text-lg font-semibold bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent transition hover:from-violet-200 hover:to-fuchsia-200"
                title="Back to dashboard"
              >
                Vault
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={refresh}
                  className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-800/60 hover:text-slate-200"
                  title="Refresh index"
                  aria-label="Refresh index"
                >
                  <ArrowsClockwise size={16} weight="bold" />
                </button>
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-800/60 hover:text-slate-200"
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  <CaretDoubleLeft size={16} weight="bold" />
                </button>
              </div>
            </div>
          </div>

          <SidebarNavList
            activeKind={view.kind}
            activePath={view.kind === 'note' ? view.path : null}
            openTaskCount={openTaskCount}
            openBookmarkCount={openBookmarkCount}
            inboxCount={inboxNotes.length}
            orphansCount={orphans.length}
            duplicatesCount={duplicates.length}
            deadAttachmentsCount={deadAttachments.length}
            onNavigate={(kind) => goTo({ kind })}
            onSettings={() => setShowSettings(true)}
            notes={visibleNotes}
            attachmentFiles={attachmentFiles}
            tags={tags}
            activeTag={activeTag}
            onSelectTag={selectTag}
            onSelectNote={navigateToNote}
          />
        </aside>
      ))}

      <main className="flex h-full flex-1 flex-col overflow-hidden">
        {!zenMode && (
        <div className="flex-shrink-0 px-6 pt-6 print:hidden">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <SearchBox onSelect={navigateToNote} />
            </div>
            <AddBookmarkBox onAdd={addBookmark} />
            {view.kind === 'home' && (
              <TasksQuickView
                tasks={tasks}
                onNavigate={navigateToNote}
                onToggle={toggleTask}
                onAdd={addTask}
                onViewAll={() => goTo({ kind: 'tasks' })}
              />
            )}
            {view.kind === 'home' && (
              <div
                className="flex flex-shrink-0 items-center rounded-full border border-slate-800 bg-slate-900/60 p-0.5 text-xs"
                title="Work mode hides the home-page mail preview column"
              >
                <button
                  onClick={() => setHomeMode('personal')}
                  className={`rounded-full px-2.5 py-1 transition ${
                    homeMode === 'personal' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Personal
                </button>
                <button
                  onClick={() => setHomeMode('work')}
                  className={`rounded-full px-2.5 py-1 transition ${
                    homeMode === 'work' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Work
                </button>
              </div>
            )}
            <GmailWidget onOpen={() => goTo({ kind: 'mail' })} />
            <button
              onClick={() => setShowNewNote(true)}
              title="New note"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xl font-medium leading-none text-white shadow-lg shadow-violet-950/50 transition-all hover:scale-105 hover:shadow-violet-700/40 active:scale-95"
            >
              +
            </button>
          </div>
        </div>
        )}

        {view.kind === 'note' && activeNote && splitActive ? (
          <div className="grid min-h-0 flex-1 grid-cols-2">
            <div
              className={`scroll-pane h-full overflow-y-auto px-6 pb-6 pt-6 ${
                primarySide === 'left' ? 'order-1' : 'order-2 border-l border-slate-800/80'
              }`}
            >
              <button
                onClick={() => goTo({ kind: 'home' })}
                className="mb-4 flex items-center gap-1 text-sm text-slate-400 hover:text-violet-300"
              >
                ← Back to dashboard
              </button>
              <NoteView
                note={activeNote}
                notes={notes}
                onNavigate={navigateToNote}
                onOpenLink={openNoteInSplit}
                onArchive={() => handleArchive(activeNote.relPath)}
                onDelete={() => handleDelete(activeNote.relPath)}
                onSaved={(updated) => {
                  setActiveNote(updated);
                  refresh();
                }}
                onSplitOpen={undefined}
                calloutIcons={calloutIcons}
                calloutColors={calloutColors}
              />
            </div>

            <div
              className={`scroll-pane h-full overflow-y-auto px-6 pb-6 pt-6 ${
                primarySide === 'left' ? 'order-2 border-l border-slate-800/80' : 'order-1'
              }`}
            >
              <div className="mb-4 flex items-center justify-between">
                {splitView.kind === 'note' ? (
                  <button
                    onClick={() => setSplitView({ kind: 'home' })}
                    className="flex items-center gap-1 text-sm text-slate-400 hover:text-violet-300"
                  >
                    ← Back
                  </button>
                ) : (
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Open a note</span>
                )}
                <button onClick={closeSplit} className="flex items-center gap-1 text-sm text-slate-400 hover:text-violet-300">
                  ✕ Close split
                </button>
              </div>

              {splitView.kind === 'home' && (
                <div>
                  <SearchBox onSelect={(relPath) => setSplitView({ kind: 'note', path: relPath })} />
                  <div className="mt-6">
                    <HomeDashboard
                      stats={stats}
                      notes={notes}
                      statColors={statColors}
                      sportColors={sportColors}
                      sportImages={sportImages}
                      onViewActivity={() => goTo({ kind: 'stats' })}
                      onViewMail={() => goTo({ kind: 'mail' })}
                      onViewSports={() => setSplitView({ kind: 'note', path: '_Templates/sports-events.md' })}
                      onSportsEventAdded={refresh}
                      activeTag={activeTag}
                      visibleNotes={visibleNotes}
                      recentNotes={recentNotes}
                      loadError={loadError}
                      onNavigateNote={(relPath) => setSplitView({ kind: 'note', path: relPath })}
                      onOpenLink={openNoteInSplit}
                      onTodayNoteSaved={refresh}
                      homeMode={homeMode}
                    />
                  </div>
                </div>
              )}

              {splitView.kind === 'note' &&
                (splitNote ? (
                  <NoteView
                    note={splitNote}
                    notes={notes}
                    onNavigate={(relPath) => setSplitView({ kind: 'note', path: relPath })}
                    onOpenLink={openNoteInSplit}
                    onArchive={() => handleSplitArchive(splitNote.relPath)}
                    onDelete={() => handleSplitDelete(splitNote.relPath)}
                    onSaved={(updated) => {
                      setSplitNote(updated);
                      refresh();
                    }}
                    calloutIcons={calloutIcons}
                    calloutColors={calloutColors}
                  />
                ) : (
                  <div className="text-sm text-slate-500">Loading…</div>
                ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
          <div ref={noteScrollRef} className="scroll-pane min-h-0 flex-1 overflow-y-auto">
            <div
              className={`mx-auto lg:flex lg:h-full lg:min-h-0 lg:flex-col ${contentMaxWidth} px-6 pb-6`}
              style={contentMaxWidthStyle}
            >
              {loadError && (
                <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 print:hidden">
                  {loadError}
                </div>
              )}

              <div className="mt-6 animate-view-in lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                {view.kind === 'tasks' && (
                  <TasksView items={tasks} onNavigate={navigateToNote} onToggle={toggleTask} onAdd={addTask} />
                )}
                {view.kind === 'bookmarks' && <BookmarksView items={bookmarks} onNavigate={navigateToNote} />}
                {view.kind === 'graph' && <GraphView onNavigate={navigateToNote} />}
                {view.kind === 'calendar' && (
                  <CalendarView
                    items={sportsEvents}
                    sportColors={sportColors}
                    onNavigate={navigateToNote}
                    onChanged={refresh}
                  />
                )}
                {view.kind === 'orphans' && <OrphansView items={orphans} onNavigate={navigateToNote} />}
                {view.kind === 'duplicates' && <DuplicatesView items={duplicates} onNavigate={navigateToNote} />}
                {view.kind === 'deadAttachments' && <DeadAttachmentsView items={deadAttachments} />}
                {view.kind === 'stats' && <StatsView notes={notes} tags={tags} />}
                {view.kind === 'mail' && <MailView />}
                {view.kind === 'specs' && <SystemSpecsView />}
                {view.kind === 'explorer' && (
                  <ExplorerView
                    notes={notes}
                    attachments={attachmentFiles}
                    onChanged={refresh}
                    onOpenNote={navigateToNote}
                    pushToast={pushToast}
                  />
                )}
                {view.kind === 'inbox' && (
                  <InboxTriageView items={inboxNotes} onNavigate={navigateToNote} onChanged={refresh} />
                )}
                {view.kind === 'note' && activeNote && (
                  <div>
                    {!zenMode && (
                      <button
                        onClick={() => goTo({ kind: 'home' })}
                        className="mb-4 flex items-center gap-1 text-sm text-slate-400 hover:text-violet-300"
                      >
                        ← Back to dashboard
                      </button>
                    )}
                    <NoteView
                      key={activeNote.relPath}
                      ref={noteViewRef}
                      note={activeNote}
                      notes={notes}
                      onNavigate={navigateToNote}
                      onOpenLink={openNoteInSplit}
                      onArchive={() => handleArchive(activeNote.relPath)}
                      onDelete={() => handleDelete(activeNote.relPath)}
                      onSaved={(updated) => {
                        setActiveNote(updated);
                        refresh();
                      }}
                      onSplitOpen={startSplit}
                      startInEditMode={autoEditPath === activeNote.relPath}
                      onAutoEditHandled={() => setAutoEditPath(null)}
                      calloutIcons={calloutIcons}
                      calloutColors={calloutColors}
                      zenMode={zenMode}
                      onToggleZen={() => setZenMode((z) => !z)}
                      onEditingChange={setActiveNoteEditing}
                    />
                  </div>
                )}
                {view.kind === 'home' && (
                  <HomeDashboard
                    stats={stats}
                    notes={notes}
                    statColors={statColors}
                    sportColors={sportColors}
                    sportImages={sportImages}
                    onViewActivity={() => goTo({ kind: 'stats' })}
                    onViewMail={() => goTo({ kind: 'mail' })}
                    onViewSports={() => navigateToNote('_Templates/sports-events.md')}
                    onSportsEventAdded={refresh}
                    activeTag={activeTag}
                    visibleNotes={visibleNotes}
                    recentNotes={recentNotes}
                    loadError={loadError}
                    onNavigateNote={navigateToNote}
                    onOpenLink={openNoteInSplit}
                    onTodayNoteSaved={refresh}
                    homeMode={homeMode}
                  />
                )}
              </div>
            </div>
          </div>
          {view.kind === 'note' && activeNote && !zenMode && (
            <OutlineRail
              outline={noteOutline}
              activeSlug={activeHeadingSlug}
              onJump={(slug) => noteViewRef.current?.jumpToHeading(slug) ?? false}
            />
          )}
          </div>
        )}

        {!zenMode && (openTabs.length > 0 || closedTabs.length > 0) && (
          <div className="scroll-pane flex-shrink-0 overflow-x-auto border-t border-slate-800/80 bg-slate-950/90 px-3 py-2 print:hidden">
            <div className="flex items-center gap-1.5">
              {closedTabs.length > 0 && (
                <button
                  onClick={reopenLastClosedTab}
                  title="Reopen last closed tab"
                  className="flex-shrink-0 rounded-full border border-slate-800 px-2 py-1 text-xs text-slate-500 transition hover:border-slate-700 hover:text-slate-200"
                >
                  ↺
                </button>
              )}
              {openTabs.map((path, index) => {
                const isActive = view.kind === 'note' && view.path === path;
                const tabTitle = notes.find((n) => n.relPath === path)?.title ?? path.split('/').pop()?.replace(/\.md$/, '') ?? path;
                return (
                  <div
                    key={path}
                    draggable
                    onDragStart={() => setDragTabIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragTabIndex !== null) reorderTabs(dragTabIndex, index);
                      setDragTabIndex(null);
                    }}
                    onDragEnd={() => setDragTabIndex(null)}
                    className={`group flex max-w-[11rem] flex-shrink-0 cursor-grab items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition active:cursor-grabbing ${
                      isActive
                        ? 'border-violet-500/50 bg-violet-500/15 text-violet-200'
                        : 'border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    } ${dragTabIndex === index ? 'opacity-50' : ''}`}
                  >
                    <button onClick={() => navigateToNote(path)} title={tabTitle} className="truncate">
                      {tabTitle}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(path);
                      }}
                      title="Close tab"
                      className="flex-shrink-0 text-slate-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view.kind === 'note' && activeNote && !splitActive && (
          <ReadingWidthControl widthRem={noteWidthRem} onChange={setNoteWidthRem} />
        )}
      </main>

      {!zenMode && (
        <aside className="hidden flex-shrink-0 border-l border-slate-800/80 bg-slate-950/60 lg:block print:hidden">
          <QuickLinksPanel />
        </aside>
      )}

      {/* Replaces the desktop sidebar below `md` — there's no room for a persistent 288px column
          on a phone screen, so navigation collapses to four bottom tabs; everything the full
          sidebar offers beyond these four (Graph, Inbox triage, Orphans, Duplicates, Dead
          attachments, Activity, Settings, folders, tags) lives one tap away behind "Menu". */}
      {!zenMode && (
      <nav
        className="flex flex-shrink-0 items-center justify-around border-t border-slate-800/80 bg-slate-950/90 py-1.5 [padding-bottom:env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        <button
          onClick={refresh}
          title="Refresh index"
          className="flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] text-slate-400"
        >
          <span className="text-lg leading-none">↻</span>
          Refresh
        </button>
        <button
          onClick={() => goTo({ kind: 'home' })}
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] ${
            view.kind === 'home' ? 'text-violet-300' : 'text-slate-400'
          }`}
        >
          <span className="text-lg leading-none">🏠</span>
          Home
        </button>
        <button
          onClick={() => goTo({ kind: 'tasks' })}
          className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] ${
            view.kind === 'tasks' ? 'text-violet-300' : 'text-slate-400'
          }`}
        >
          <span className="text-lg leading-none">✅</span>
          Tasks
          {openTaskCount > 0 && (
            <span className="absolute right-3 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-medium text-white">
              {openTaskCount}
            </span>
          )}
        </button>
        <button
          onClick={() => goTo({ kind: 'bookmarks' })}
          className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] ${
            view.kind === 'bookmarks' ? 'text-violet-300' : 'text-slate-400'
          }`}
        >
          <span className="text-lg leading-none">🔖</span>
          Bookmarks
          {openBookmarkCount > 0 && (
            <span className="absolute right-3 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-medium text-white">
              {openBookmarkCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setMobileMenuOpen(true)}
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] ${
            mobileMenuOpen ? 'text-violet-300' : 'text-slate-400'
          }`}
        >
          <span className="text-lg leading-none">☰</span>
          Menu
        </button>
      </nav>
      )}

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative ml-auto flex h-full w-[85%] max-w-sm flex-col border-l border-slate-800/80 bg-slate-950">
            <div className="flex-shrink-0 border-b border-slate-800/80 bg-slate-950/90 p-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-semibold bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
                  Menu
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={refresh}
                    className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-800/60 hover:text-slate-200"
                    title="Refresh index"
                  >
                    ↻
                  </button>
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-800/60 hover:text-slate-200"
                    title="Close menu"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
            <SidebarNavList
              activeKind={view.kind}
              activePath={view.kind === 'note' ? view.path : null}
              openTaskCount={openTaskCount}
              openBookmarkCount={openBookmarkCount}
              inboxCount={inboxNotes.length}
              orphansCount={orphans.length}
              duplicatesCount={duplicates.length}
              deadAttachmentsCount={deadAttachments.length}
              onNavigate={(kind) => {
                goTo({ kind });
                setMobileMenuOpen(false);
              }}
              onSettings={() => {
                setShowSettings(true);
                setMobileMenuOpen(false);
              }}
              notes={visibleNotes}
              attachmentFiles={attachmentFiles}
              tags={tags}
              activeTag={activeTag}
              onSelectTag={(tag) => {
                selectTag(tag);
                setMobileMenuOpen(false);
              }}
              onSelectNote={(relPath) => {
                navigateToNote(relPath);
                setMobileMenuOpen(false);
              }}
              showTags={false}
            />
          </div>
        </div>
      )}

      {!zenMode && (
        <DockNav
          activeKind={view.kind}
          openTaskCount={openTaskCount}
          inboxCount={inboxNotes.length}
          orphansCount={orphans.length}
          duplicatesCount={duplicates.length}
          deadAttachmentsCount={deadAttachments.length}
          onNavigate={(kind: DockKind) => goTo({ kind })}
          onOpenToday={openTodayNote}
        />
      )}

      {zenMode && (
        <button
          onClick={() => setZenMode(false)}
          title="Exit zen mode"
          className="fixed right-4 top-4 z-50 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300 shadow-lg backdrop-blur-sm hover:border-violet-500/50 hover:text-violet-300"
        >
          ✕ Exit zen
        </button>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {showNewNote && (
        <NewNoteModal
          onClose={() => setShowNewNote(false)}
          onCreated={(note) => {
            setShowNewNote(false);
            refresh();
            setView({ kind: 'note', path: note.relPath });
            setActiveNote(note);
            setAutoEditPath(note.relPath);
          }}
        />
      )}

      {showSettings && (
        <CalloutSettingsModal
          calloutIcons={calloutIcons}
          calloutColors={calloutColors}
          statColors={statColors}
          sportColors={sportColors}
          sportImages={sportImages}
          knownSportTags={knownSportTags}
          videoVolume={videoVolume}
          attachmentFiles={attachmentFiles}
          siteIcon={siteIcon}
          onSiteIconChange={setSiteIcon}
          onClose={() => setShowSettings(false)}
          onSaved={(icons, colors, statColors, sportColors, sportImages, nextVideoVolume) => {
            setCalloutIcons(icons);
            setCalloutColors(colors);
            setStatColors(statColors);
            setSportColors(sportColors);
            setSportImages(sportImages);
            setVideoVolume(nextVideoVolume);
          }}
        />
      )}

      {folderModal && (
        <FolderNotesModal
          folder={folderModal}
          notes={notes.filter((n) => topFolder(n.folder) === folderModal)}
          onClose={() => setFolderModal(null)}
          onSelect={(relPath) => {
            setFolderModal(null);
            navigateToNote(relPath);
          }}
        />
      )}
    </div>
  );
}
