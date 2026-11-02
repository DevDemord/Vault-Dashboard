import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { jsPDF } from 'jspdf';
import { api, ApiError } from '../api';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
import { remarkObsidianCallouts } from './remarkCallouts';
import { remarkHeadingAlign } from './remarkHeadingAlign';
import { CALLOUT_STYLES, DEFAULT_CALLOUT_STYLE, IMAGE_ICON_PREFIX, hexToRgb } from './calloutTypes';
import { ColumnsModal } from './ColumnsModal';
import { findMultiColumnBlockAt, serializeMultiColumn, type ColumnData } from './multiColumnBlock';
import { CodeColumnsModal } from './CodeColumnsModal';
import { findCodeColumnsBlockAt, serializeCodeColumns, type CodeColumnData } from './codeColumnsBlock';
import { extractOutline } from './outline';
import { splitHeaderBody } from './noteSplit';
import { VersionHistoryModal } from './VersionHistoryModal';
import { NoteHoverPreview } from './NoteHoverPreview';
import type { NoteDetail, NoteSummary } from '../types';

/**
 * Renders an Obsidian-style callout (`> [!type] Title`), tagged by `remarkObsidianCallouts` with
 * `data-callout`/`data-callout-title` on the blockquote. `multi-column` is this vault's existing
 * convention (via the Multi-Column Markdown plugin's nested-callout pattern) for side-by-side
 * callouts — it carries no visual card of its own, just a flex row wrapping its nested-callout
 * children, each of which renders as a normal card below and wraps onto the next row once there's
 * no room, giving 2/3/4-up on a wide note and 1-up on a narrow one.
 */
/** Renders a callout's icon slot — either the plain emoji/text glyph, or (when the settings modal
 * uploaded an image for this type) the uploaded image, served back from the vault's attachments
 * endpoint by the relative path stashed after the `img:` prefix. */
function CalloutIcon({ icon }: { icon: string }) {
  if (icon.startsWith(IMAGE_ICON_PREFIX)) {
    const relPath = icon.slice(IMAGE_ICON_PREFIX.length);
    return <img src={`/api/attachments/${encodeURIComponent(relPath)}`} alt="" className="h-4 w-4 object-contain" />;
  }
  return <span>{icon}</span>;
}

function Callout({
  type,
  title,
  iconOverride,
  colorOverride,
  children,
}: {
  type: string;
  title: string;
  iconOverride?: string;
  colorOverride?: string;
  children: ReactNode;
}) {
  if (type === 'multi-column' || type === 'code-columns') {
    return <div className="my-3 flex flex-wrap gap-3">{children}</div>;
  }
  // A code-columns block's own column — bare, no card/border/icon/title, just the code block
  // itself sized to sit as a flex item alongside its siblings in the row above.
  if (type === 'code-column') {
    return <div className="min-w-[14rem] flex-1">{children}</div>;
  }
  const style = CALLOUT_STYLES[type] ?? DEFAULT_CALLOUT_STYLE;
  const rgb = (colorOverride && hexToRgb(colorOverride)) || style.rgb;
  return (
    <div
      className="my-3 min-w-[14rem] flex-1 rounded-xl border px-3 py-2"
      style={{
        borderColor: `rgba(${rgb},0.45)`,
        backgroundImage: `linear-gradient(135deg, rgba(${rgb},0.12), transparent 70%)`,
        boxShadow: `0 0 22px -10px rgba(${rgb},0.35)`,
      }}
    >
      <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-100">
        <CalloutIcon icon={iconOverride ?? style.icon} />
        <span>{title}</span>
      </div>
      <div className="text-sm text-slate-300 [&>*:last-child]:mb-0">{children}</div>
    </div>
  );
}

/**
 * `navigator.clipboard` is only exposed in secure contexts (HTTPS/localhost) — this dashboard is
 * plain HTTP on a Tailscale IP, so it's `undefined` here. Falls back to the old
 * `document.execCommand('copy')` trick (deprecated but still universally supported, and the only
 * thing that works without HTTPS).
 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path below
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** A fenced code block in the read view, with a "Copy" button that appears on hover. */
function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = preRef.current?.textContent ?? '';
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="group relative">
      <pre ref={preRef} {...props}>
        {children}
      </pre>
      <button
        onClick={handleCopy}
        title="Copy code"
        className="absolute right-2 top-2 rounded border border-slate-700 bg-slate-800/90 px-2 py-1 text-xs text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:border-violet-500/50 hover:text-violet-300"
      >
        {copied ? '✓ Copied' : '⧉ Copy'}
      </button>
    </div>
  );
}

function readingTime(words: number): string {
  const mins = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function downloadMarkdown(note: NoteDetail, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${note.title}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Strips inline markdown markers (bold/italic/links/code) down to plain text for the PDF export. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

/**
 * Renders the note's markdown body into a simple paginated PDF — headings, bullet lists, and
 * wrapped paragraphs, no tables/images/code blocks beyond plain text. jsPDF only does text/vector
 * drawing (no HTML layout), so this is a lightweight line-by-line pass rather than a pixel-perfect
 * replica of the rendered page; good enough for "I want a PDF copy of this note" without needing
 * a much heavier HTML-to-canvas pipeline.
 */
function downloadPdf(note: NoteDetail) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginX = 18;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - marginX * 2;
  let y = 20;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 15) {
      doc.addPage();
      y = 20;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  const titleLines = doc.splitTextToSize(note.title, maxWidth);
  doc.text(titleLines, marginX, y);
  y += titleLines.length * 8 + 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);

  for (const rawLine of note.renderedBody.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      y += 4;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = Math.max(16 - level * 1.5, 11);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(size);
      ensureSpace(size * 0.5 + 4);
      const wrapped = doc.splitTextToSize(stripInlineMarkdown(heading[2]), maxWidth);
      doc.text(wrapped, marginX, y);
      y += wrapped.length * (size * 0.5) + 4;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    const text = stripInlineMarkdown(bullet ? bullet[1] : line);
    const indent = bullet ? 6 : 0;
    ensureSpace(7);
    const wrapped = doc.splitTextToSize(bullet ? `•  ${text}` : text, maxWidth - indent);
    doc.text(wrapped, marginX + indent, y);
    y += wrapped.length * 5.5 + 2;
  }

  doc.save(`${note.title}.pdf`);
}

type SplitSide = 'left' | 'right';

export interface NoteViewHandle {
  /** Tries to handle an outline-rail click itself (scrolling the live editor to that heading's
   * line) and returns whether it did. Only does anything while actively editing — otherwise
   * there's a real rendered `<h1 id="slug">` to scroll to, which the outline rail already
   * handles itself via a plain DOM lookup, so returning false here just means "not my job,
   * do your normal thing." */
  jumpToHeading: (slug: string) => boolean;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** Matches TodayNote's own autosave delay — same box, same feel, so switching between "today's
 * quick capture" and "full note editor" doesn't context-switch the save behavior too. */
const AUTOSAVE_DELAY_MS = 1200;

export const NoteView = forwardRef<
  NoteViewHandle,
  {
    note: NoteDetail;
    /** Full vault note list, for the editor's `[[wikilink` autocomplete — not filtered to the
     * current folder/tag, since linking should be able to reach any note in the vault. */
    notes?: NoteSummary[];
    onNavigate: (relPath: string) => void;
    /** Clicking a `[[wikilink]]` — in the rendered body or, Ctrl/Cmd+click, in the editor —
     * calls this instead of `onNavigate`: it always opens the target as a split pane on the
     * right rather than replacing what's currently showing. Falls back to `onNavigate` if not
     * given, so a caller that hasn't opted into split-on-link-click still gets *some* behavior
     * rather than a dead link. */
    onOpenLink?: (relPath: string) => void;
    onArchive: () => void;
    onDelete: () => void;
    onSaved: (updated: NoteDetail) => void;
    onSplitOpen?: (side: SplitSide) => void;
    /** Skip the read view and open straight into editing — for a just-created note, where
     * there's nothing to read yet and clicking "Edit" first would just be friction. */
    startInEditMode?: boolean;
    onAutoEditHandled?: () => void;
    /** User-set icon/color overrides from the callout settings modal, keyed by `[!type]`. Icons
     * may be plain emoji/text or an `img:`-prefixed uploaded image path; colors are hex strings. */
    calloutIcons?: Record<string, string>;
    calloutColors?: Record<string, string>;
    /** When true, hides this note's own title/toolbar/metadata/tags/backlinks — everything
     * except the rendered content. Exiting is handled by the caller (a floating button outside
     * this component), since the toggle that lives in the now-hidden toolbar is unreachable once
     * active. Only wired up for the single-note view, not split view — same scope cut as the
     * outline rail. */
    zenMode?: boolean;
    onToggleZen?: () => void;
    /** Lets the caller widen the content column while editing — the reading-width cap is sized
     * for comfortable prose, not for writing, so the editor wants the full available width
     * instead. */
    onEditingChange?: (editing: boolean) => void;
  }
>(function NoteView(
  {
    note,
    notes,
    onNavigate,
    onOpenLink,
    onArchive,
    onDelete,
    onSaved,
    onSplitOpen,
    startInEditMode,
    onAutoEditHandled,
    calloutIcons,
    calloutColors,
    zenMode,
    onToggleZen,
    onEditingChange,
  },
  ref,
) {
  const isArchived = note.folder === '5. Archive';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // The inline "Saving…/Saved" text next to the title scrolls out of view on a long note, which
  // defeats the point — this mirrors `saveState` into a `position: fixed` badge (below) that
  // stays on screen no matter how far down you've scrolled, same as the toast stack. "Saved"
  // lingers for a couple seconds so it's actually seen, then the badge clears itself.
  const [saveBadgeVisible, setSaveBadgeVisible] = useState(false);
  useEffect(() => {
    if (saveState === 'idle') {
      setSaveBadgeVisible(false);
      return;
    }
    setSaveBadgeVisible(true);
    if (saveState === 'saved') {
      const t = setTimeout(() => setSaveBadgeVisible(false), 2500);
      return () => clearTimeout(t);
    }
  }, [saveState]);
  const [editError, setEditError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `draft` but updated synchronously on every keystroke (state updates inside the
  // editor's onChange are batched/async) — `doSave` and the unmount flush below both need the
  // actual latest text, not whatever `draft` happened to re-render with last.
  const latestBody = useRef<string>('');
  const [splitPickerOpen, setSplitPickerOpen] = useState(false);
  const [downloadPickerOpen, setDownloadPickerOpen] = useState(false);
  const [alignPickerOpen, setAlignPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRaw, setHistoryRaw] = useState<string | null>(null);
  // Tracks whether the sticky button toolbar has peeled off its normal spot (next to the title)
  // and docked under the search bar — toggled by the IntersectionObserver below watching a zero-
  // height sentinel placed right where the toolbar starts. Drives the icon-only compact style so
  // the docked toolbar doesn't crowd the search bar with full text labels.
  const [toolbarStuck, setToolbarStuck] = useState(false);
  const toolbarSentinelRef = useRef<HTMLDivElement>(null);
  const outline = useMemo(() => extractOutline(note.renderedBody), [note.renderedBody]);
  const [relatedNotes, setRelatedNotes] = useState<NoteSummary[]>([]);
  useEffect(() => {
    api.related(note.relPath).then(setRelatedNotes).catch(() => setRelatedNotes([]));
  }, [note.relPath]);
  // Fires on mount too (with the initial `false`), not just on later toggles — the parent's own
  // copy of this flag needs to come back down to false when a remount (switching notes) resets
  // `editing` to false right along with it.
  useEffect(() => {
    onEditingChange?.(editing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const [columnsModal, setColumnsModal] = useState<{
    mode: 'insert' | 'edit';
    columns: ColumnData[];
    fromLine?: number;
    toLine?: number;
  } | null>(null);
  const [codeColumnsModal, setCodeColumnsModal] = useState<{
    mode: 'insert' | 'edit';
    columns: CodeColumnData[];
    fromLine?: number;
    toLine?: number;
  } | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  useImperativeHandle(
    ref,
    () => ({
      jumpToHeading: (slug: string) => {
        if (!editing) return false;
        const item = outline.find((o) => o.slug === slug);
        if (!item) return false;
        editorRef.current?.scrollToLine(item.line);
        return true;
      },
    }),
    [editing, outline],
  );
  // Frontmatter + the note's own leading H1 are boilerplate the editor has no business showing —
  // the page already renders the title as its own `<h1>` above — so only the body is ever loaded
  // into the editor. Stashed here (not state) purely to be stitched back in unedited on save.
  const headerRef = useRef<string>('');

  const startEditing = async () => {
    setEditError(null);
    try {
      const content = await api.getRaw(note.relPath);
      const { header, body } = splitHeaderBody(content);
      headerRef.current = header;
      latestBody.current = body;
      setDraft(body);
      setSaveState('idle');
      setEditing(true);
    } catch {
      setEditError('Could not load this note for editing.');
    }
  };

  const doSave = async () => {
    setSaveState('saving');
    try {
      const updated = await api.updateRaw(note.relPath, headerRef.current + latestBody.current);
      setSaveState('saved');
      onSaved(updated);
    } catch (err) {
      setSaveState('error');
      setEditError(err instanceof ApiError ? err.message : 'Could not save this note.');
    }
  };

  /** Wired up as the editor's `onChange` — debounce-saves ~1.2s after typing stops, the same
   * zero-friction behavior as the Today note, so there's no Save button to remember to click. */
  const handleChange = (body: string) => {
    latestBody.current = body;
    setSaveState('dirty');
    setEditError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void doSave(), AUTOSAVE_DELAY_MS);
  };

  /** "Done" just closes the editor — flushing first if a debounced save is still pending, so
   * closing right after typing can't ever drop the last ~1.2s of edits. */
  const finishEditing = async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await doSave();
    }
    setEditing(false);
    setEditError(null);
  };

  // Same reasoning as TodayNote's unmount flush: a pending debounce timer means unsaved
  // keystrokes, and switching notes (which remounts this component via its `key`) is no reason
  // to lose them.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void api.updateRaw(note.relPath, headerRef.current + latestBody.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.relPath]);

  // Runs once per mount (the parent remounts this component per-note via `key`), so a note that's
  // freshly created gets dropped straight into editing without a second mount of the same note
  // re-triggering it.
  const autoEditTriggered = useRef(false);
  useEffect(() => {
    if (startInEditMode && !autoEditTriggered.current) {
      autoEditTriggered.current = true;
      void startEditing();
      onAutoEditHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-attached whenever `editing` flips, since the sentinel only exists in the read-view JSX
  // branch below — switching into/out of edit mode unmounts/remounts it.
  useEffect(() => {
    const sentinel = toolbarSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setToolbarStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [editing]);

  const exportMarkdown = async () => {
    const content = await api.getRaw(note.relPath).catch(() => note.renderedBody);
    downloadMarkdown(note, content);
  };

  const openHistory = async () => {
    try {
      const content = await api.getRaw(note.relPath);
      setHistoryRaw(content);
      setHistoryOpen(true);
    } catch {
      setEditError('Could not load version history for this note.');
    }
  };

  const openColumnsModal = () => {
    const content = editorRef.current?.getValue() ?? draft;
    const cursorLine = editorRef.current?.getCursorLine() ?? 1;
    const existing = findMultiColumnBlockAt(content, cursorLine);
    if (existing) {
      setColumnsModal({ mode: 'edit', columns: existing.columns, fromLine: existing.fromLine, toLine: existing.toLine });
    } else {
      setColumnsModal({
        mode: 'insert',
        columns: [
          { type: 'note', title: '', content: '' },
          { type: 'note', title: '', content: '' },
        ],
      });
    }
  };

  const submitColumns = (columns: ColumnData[]) => {
    if (!columnsModal) return;
    const text = serializeMultiColumn(columns);
    if (columnsModal.mode === 'edit' && columnsModal.fromLine && columnsModal.toLine) {
      editorRef.current?.replaceLines(columnsModal.fromLine, columnsModal.toLine, text);
    } else {
      editorRef.current?.insertAtCursor(text);
    }
    setColumnsModal(null);
  };

  const openCodeColumnsModal = () => {
    const content = editorRef.current?.getValue() ?? draft;
    const cursorLine = editorRef.current?.getCursorLine() ?? 1;
    const existing = findCodeColumnsBlockAt(content, cursorLine);
    if (existing) {
      setCodeColumnsModal({ mode: 'edit', columns: existing.columns, fromLine: existing.fromLine, toLine: existing.toLine });
    } else {
      setCodeColumnsModal({
        mode: 'insert',
        columns: [
          { language: '', content: '' },
          { language: '', content: '' },
        ],
      });
    }
  };

  const submitCodeColumns = (columns: CodeColumnData[]) => {
    if (!codeColumnsModal) return;
    const text = serializeCodeColumns(columns);
    if (codeColumnsModal.mode === 'edit' && codeColumnsModal.fromLine && codeColumnsModal.toLine) {
      editorRef.current?.replaceLines(codeColumnsModal.fromLine, codeColumnsModal.toLine, text);
    } else {
      editorRef.current?.insertAtCursor(text);
    }
    setCodeColumnsModal(null);
  };

  /** Writes (or clears) the trailing `{.center}` / `{.right}` marker (see remarkHeadingAlign.ts)
   * on whichever line the cursor is on. Only does anything if that line is actually a heading —
   * aligning body text isn't supported, so this quietly no-ops rather than mangling a random
   * line. */
  const applyHeadingAlign = (align: 'left' | 'center' | 'right') => {
    setAlignPickerOpen(false);
    const editor = editorRef.current;
    if (!editor) return;
    const lineNum = editor.getCursorLine();
    const lines = editor.getValue().split('\n');
    const line = lines[lineNum - 1] ?? '';
    if (!/^#{1,6}\s+/.test(line)) {
      setEditError('Place your cursor on a heading line, then try Align again.');
      return;
    }
    setEditError(null);
    const base = line.replace(/\s*\{\.(center|right)\}\s*$/, '');
    editor.replaceLines(lineNum, lineNum, align === 'left' ? base : `${base} {.${align}}`);
  };

  if (editing) {
    return (
      <div>
        {/* Docked (position: sticky) to the top of the note's own scroll pane — same technique
            the read view's toolbar already uses below — rather than scrolling away with the
            title once you're a screen or two down into a long note. `sticky` (not `fixed`) so it
            stays within this note's own scrollable area instead of floating over the whole page,
            and naturally lands right under the search bar above since that bar lives outside this
            scroll pane entirely (it's its own flex-shrink-0 row in App.tsx, never scrolls). */}
        <div className="sticky top-0 z-10 mb-3 flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-950/95 p-2 shadow-lg shadow-black/30 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-xl font-semibold text-slate-100">Editing · {note.title}</h1>
            <span className="text-xs text-slate-500">
              {saveState === 'dirty' && 'Unsaved changes…'}
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'saved' && 'Saved'}
              {saveState === 'error' && <span className="text-red-400">Could not save</span>}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={openColumnsModal}
              title="Insert side-by-side columns, or edit the ones your cursor is in"
              className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-violet-500/50 hover:text-violet-300"
            >
              ⊞ Columns
            </button>
            <button
              onClick={openCodeColumnsModal}
              title="Insert side-by-side code blocks, or edit the ones your cursor is in"
              className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-violet-500/50 hover:text-violet-300"
            >
              {'</>'} Code columns
            </button>
            <div className="relative">
              <button
                onClick={() => setAlignPickerOpen((v) => !v)}
                title="Center or right-align the heading your cursor is on"
                className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-violet-500/50 hover:text-violet-300"
              >
                ↔ Align
              </button>
              {alignPickerOpen && (
                <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-slate-800 bg-slate-900 p-1 shadow-xl">
                  <button
                    onClick={() => applyHeadingAlign('left')}
                    className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-violet-300"
                  >
                    ⇤ Left (default)
                  </button>
                  <button
                    onClick={() => applyHeadingAlign('center')}
                    className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-violet-300"
                  >
                    ↔ Center
                  </button>
                  <button
                    onClick={() => applyHeadingAlign('right')}
                    className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-violet-300"
                  >
                    ⇥ Right
                  </button>
                </div>
              )}
            </div>
            {onToggleZen && (
              <button
                onClick={onToggleZen}
                title="Zen mode — hide everything but the editor"
                className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-violet-500/50 hover:text-violet-300"
              >
                ⛶ Zen
              </button>
            )}
            <button
              onClick={() => void finishEditing()}
              className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500"
            >
              Done
            </button>
          </div>
        </div>
        {editError && (
          <div className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-sm text-red-300">
            {editError}
          </div>
        )}
        {saveBadgeVisible && (
          // bottom-36 (not bottom-4) so it clears both the mobile bottom tab bar and the docked
          // Done button below, and right-4 (not left-4) so it doesn't land on top of the
          // always-visible left icon rail — both of which made the first version of this badge
          // easy to miss or mistake for not showing up at all.
          <div className="pointer-events-none fixed bottom-36 right-4 z-50 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-sm text-slate-200 shadow-xl print:hidden">
            {saveState === 'dirty' && <>⏳ Unsaved changes…</>}
            {saveState === 'saving' && <>💾 Saving…</>}
            {saveState === 'saved' && <>✓ Saved</>}
            {saveState === 'error' && <span className="text-red-400">⚠ Could not save</span>}
          </div>
        )}
        {/* No fixed height, no border, no internal scroller — unlike the default (a boxed,
            fixed-height editor with its own scrollbar, still used by the Today note's compact
            widget), the full editor now just grows with its content and lets the page's own
            scroll-pane handle overflow, the way Obsidian's own editor reads as part of the page
            rather than a window sitting on top of it. */}
        <MarkdownEditor
          ref={editorRef}
          initialValue={draft}
          onChange={handleChange}
          notes={notes}
          onOpenLink={onOpenLink}
          className=""
        />
        {/* Docked (position: fixed), not placed after the editor content — a note long enough to
            need scrolling would otherwise hide this below the fold just like the old Save button
            did, defeating the point of adding it. Stacked below the save badge above, and above
            the error-toast stack (also bottom-4 right-4) so none of the three ever overlap. */}
        <button
          onClick={() => void finishEditing()}
          className="fixed bottom-20 right-4 z-50 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-xl hover:bg-violet-500 print:hidden"
        >
          Done
        </button>
        {columnsModal && (
          <ColumnsModal
            mode={columnsModal.mode}
            initialColumns={columnsModal.columns}
            onClose={() => setColumnsModal(null)}
            onSubmit={submitColumns}
          />
        )}
        {codeColumnsModal && (
          <CodeColumnsModal
            mode={codeColumnsModal.mode}
            initialColumns={codeColumnsModal.columns}
            onClose={() => setCodeColumnsModal(null)}
            onSubmit={submitCodeColumns}
          />
        )}
      </div>
    );
  }

  let headingCursor = 0;
  const headingComponent = (tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    function Heading({ children, ...props }: ComponentPropsWithoutRef<typeof tag>) {
      const slug = outline[headingCursor]?.slug;
      headingCursor += 1;
      const Tag = tag;
      const align = (props as Record<string, unknown>)['data-align'] as string | undefined;
      const style = align === 'center' || align === 'right' ? { textAlign: align as 'center' | 'right' } : undefined;
      return (
        <Tag id={slug} {...props} style={style}>
          {children}
        </Tag>
      );
    };

  return (
    <div>
      {zenMode && (
        <button
          onClick={startEditing}
          title="Edit this note"
          className="fixed bottom-4 right-4 z-40 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300 shadow-lg backdrop-blur-sm hover:border-violet-500/50 hover:text-violet-300"
        >
          ✎ Edit
        </button>
      )}
      {!zenMode && (
      <>
      {/* 1px marker at the toolbar's normal flow position — the IntersectionObserver above watches
          this, not the toolbar itself, since the toolbar's own box never leaves the DOM flow
          (sticky elements keep their layout slot) so it would never report scrolling out of view
          on its own. A truly zero-height (0×width) target is a degenerate case some browsers'
          IntersectionObserver implementations don't reliably fire on, hence `h-px` rather than no
          height at all. */}
      <div ref={toolbarSentinelRef} className="h-px" />
      {/* This has to be a direct child of the outer (whole-note-tall) container, not nested inside
          the small title row — `position: sticky` can't stick a box past the bottom edge of its
          own immediate parent, so nesting it in a row sized only to the title's height capped the
          stickiness to that row's few pixels and it never reached the search bar. */}
      <div
        className={`sticky top-0 z-10 mb-2 flex flex-wrap justify-end gap-1 rounded-lg p-1 ${
          toolbarStuck ? 'border border-slate-800/80 bg-slate-950/95 shadow-lg shadow-black/30 backdrop-blur-sm' : ''
        }`}
      >
        {onSplitOpen && (
              <div className="relative">
                <button
                  onClick={() => setSplitPickerOpen((v) => !v)}
                  title="Open another note side-by-side"
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
                >
                  ⧉{!toolbarStuck && ' Split'}
                </button>
                {splitPickerOpen && (
                  <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-800 bg-slate-900 p-2 shadow-xl">
                    <div className="mb-1.5 px-1 text-[11px] text-slate-500">Move this note to:</div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          setSplitPickerOpen(false);
                          onSplitOpen('left');
                        }}
                        className="flex-1 rounded border border-slate-700 py-1.5 text-xs text-slate-300 hover:border-violet-500/50 hover:text-violet-300"
                      >
                        ◧ Left
                      </button>
                      <button
                        onClick={() => {
                          setSplitPickerOpen(false);
                          onSplitOpen('right');
                        }}
                        className="flex-1 rounded border border-slate-700 py-1.5 text-xs text-slate-300 hover:border-violet-500/50 hover:text-violet-300"
                      >
                        ◨ Right
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={openHistory}
              title="Version history"
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
            >
              🕐{!toolbarStuck && ' History'}
            </button>
            <button
              onClick={startEditing}
              title="Edit this note"
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
            >
              ✎{!toolbarStuck && ' Edit'}
            </button>
            <div className="relative">
              <button
                onClick={() => setDownloadPickerOpen((v) => !v)}
                title="Download this note"
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
              >
                ⬇{!toolbarStuck && ' Download'}
              </button>
              {downloadPickerOpen && (
                <div className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-slate-800 bg-slate-900 p-1 shadow-xl">
                  <button
                    onClick={() => {
                      setDownloadPickerOpen(false);
                      void exportMarkdown();
                    }}
                    className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-violet-300"
                  >
                    Markdown (.md)
                  </button>
                  <button
                    onClick={() => {
                      setDownloadPickerOpen(false);
                      downloadPdf(note);
                    }}
                    className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-violet-300"
                  >
                    PDF (.pdf)
                  </button>
                </div>
              )}
            </div>
            {onToggleZen && (
              <button
                onClick={onToggleZen}
                title="Zen mode — hide everything but the note content"
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
              >
                ⛶{!toolbarStuck && ' Zen'}
              </button>
            )}
            {!isArchived && (
              <button
                onClick={onArchive}
                title="Move to 5. Archive"
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-amber-500/50 hover:text-amber-300"
              >
                📦{!toolbarStuck && ' Archive'}
              </button>
            )}
            <button
              onClick={onDelete}
              title="Move to .trash"
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-red-500/50 hover:text-red-300"
            >
              🗑{!toolbarStuck && ' Delete'}
            </button>
      </div>

      <div className="mb-4 border-b border-slate-800 pb-4">
        <h1 className="font-display text-2xl font-semibold text-slate-100">{note.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{note.folder || '(root)'}</span>
          <span>·</span>
          <span>edited {formatDate(note.mtime)}</span>
          <span>·</span>
          <span>{note.wordCount} words</span>
          <span>·</span>
          <span>{readingTime(note.wordCount)}</span>
        </div>
        {note.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {note.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-slate-800 px-2 py-0.5 text-xs text-slate-400">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {/* `headingCursor` is a plain local (not state/ref) — split view renders two independent
          `NoteView` instances at once, each with its own call to this function and so its own
          copy of this variable, re-zeroed every render; a module-level counter would leak
          between those two panes. The heading overrides below consume `outline` by position
          (not by re-deriving a slug from the rendered text) so the two stay in exact sync. */}
      <div className="prose-note">
        {/* remarkBreaks (single `\n` -> a real line break, matching Obsidian's own default
            rendering instead of strict CommonMark collapsing it to a space) must run *after*
            remarkObsidianCallouts — that plugin reads a paragraph's first text node as one
            string to split the `[!type] Title` header off the rest; if breaks ran first, that
            text node would already be fragmented into text/break pairs and the header line
            lookup would no longer see the lines it needs in one string. */}
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkHeadingAlign, remarkObsidianCallouts, remarkBreaks]}
          // react-markdown's default urlTransform only allows http(s)/irc(s)/mailto/xmpp
          // schemes and silently blanks anything else — including our own `obsidian://note/...`
          // and `obsidian://unresolved/...` hrefs, which made every internal-link `a` below fall
          // through to the generic external-link branch (empty href, target="_blank") instead of
          // ever matching the `obsidian://` prefix checks. Pass those through untouched; keep the
          // default sanitizer for everything else.
          urlTransform={(url) => (url.startsWith('obsidian://') ? url : defaultUrlTransform(url))}
          components={{
            pre: CodeBlock,
            h1: headingComponent('h1'),
            h2: headingComponent('h2'),
            h3: headingComponent('h3'),
            h4: headingComponent('h4'),
            h5: headingComponent('h5'),
            h6: headingComponent('h6'),
            blockquote: ({ children, ...props }) => {
              const type = (props as Record<string, unknown>)['data-callout'] as string | undefined;
              const title = (props as Record<string, unknown>)['data-callout-title'] as string | undefined;
              if (type) {
                return (
                  <Callout
                    type={type}
                    title={title ?? type}
                    iconOverride={calloutIcons?.[type]}
                    colorOverride={calloutColors?.[type]}
                  >
                    {children}
                  </Callout>
                );
              }
              return <blockquote {...props}>{children}</blockquote>;
            },
            a: ({ href, children, ...props }) => {
              if (href?.startsWith('obsidian://note/')) {
                const target = decodeURIComponent(href.replace('obsidian://note/', ''));
                return (
                  <a
                    className="internal-link"
                    onClick={(e) => {
                      e.preventDefault();
                      (onOpenLink ?? onNavigate)(target);
                    }}
                    href="#"
                  >
                    {children}
                  </a>
                );
              }
              if (href?.startsWith('obsidian://unresolved/')) {
                const name = decodeURIComponent(href.replace('obsidian://unresolved/', ''));
                return (
                  <a className="unresolved-link" title={`Note "${name}" not found`} href="#" onClick={(e) => e.preventDefault()}>
                    {children}
                  </a>
                );
              }
              return (
                <a className="external-link" href={href} target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                </a>
              );
            },
          }}
        >
          {note.renderedBody}
        </ReactMarkdown>
      </div>

      {!zenMode && note.backlinks.length > 0 && (
        <div className="mt-8 border-t border-slate-800 pt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Linked from ({note.backlinks.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {note.backlinks.map((bl) => (
              <NoteHoverPreview key={bl.relPath} note={bl}>
                <button
                  onClick={() => onNavigate(bl.relPath)}
                  className="rounded border border-slate-800 px-2 py-1 text-xs text-violet-300 hover:border-violet-500/60"
                >
                  {bl.title}
                </button>
              </NoteHoverPreview>
            ))}
          </div>
        </div>
      )}

      {!zenMode && relatedNotes.length > 0 && (
        <div className="mt-8 border-t border-slate-800 pt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Related notes
          </div>
          <div className="flex flex-wrap gap-2">
            {relatedNotes.map((rn) => (
              <NoteHoverPreview key={rn.relPath} note={rn}>
                <button
                  onClick={() => onNavigate(rn.relPath)}
                  className="rounded border border-slate-800 px-2 py-1 text-xs text-cyan-300 hover:border-cyan-500/60"
                >
                  {rn.title}
                </button>
              </NoteHoverPreview>
            ))}
          </div>
        </div>
      )}

      {historyOpen && historyRaw !== null && (
        <VersionHistoryModal
          relPath={note.relPath}
          currentContent={historyRaw}
          onClose={() => {
            setHistoryOpen(false);
            setHistoryRaw(null);
          }}
          onRestored={(updated) => onSaved(updated)}
        />
      )}
    </div>
  );
});
