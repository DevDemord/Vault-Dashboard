import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { liveMarkdownPreviewExtensions, linkUrlAtPos, wikilinkTargetAtPos } from './liveMarkdownPreview';
import { resolveWikilinkTarget, wikilinkCompletionSource } from './wikilinkCompletion';
import { api } from '../api';
import type { NoteSummary } from '../types';

/** Nearest ancestor (starting at `el` itself) that's actually the one scrolling — walks up past
 * any `overflow-y: auto/scroll` element whose content doesn't overflow it. That skip matters
 * here: CodeMirror's own `.cm-scroller` (`view.scrollDOM`) gets `overflow: auto` from the editor
 * theme, but when the editor is mounted with no fixed height (the full note-edit page uses
 * `className=""`) it never actually overflows — the page's own scroll pane several levels up
 * does the real scrolling instead, so `EditorView.scrollIntoView` (which only ever scrolls
 * `view.scrollDOM`) would silently do nothing there. */
function nearestScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

/** Keeps `lines` worth of vertical breathing room around the cursor — without this, pressing
 * Enter on the last visible line (or arrowing past the top/bottom edge) moves the cursor past
 * what's currently scrolled into view, so it looks like typing "does nothing" until you manually
 * scroll. Compares the cursor's actual screen position against whichever ancestor really scrolls
 * (see `nearestScrollParent`) rather than relying on CodeMirror's own scroll handling, since that
 * only covers the case where the editor's internal scroller owns the overflow. */
function scrollCursorMargin(lines: number) {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet) return;
    const view = update.view;
    const coords = view.coordsAtPos(update.state.selection.main.head);
    if (!coords) return;
    const scroller = nearestScrollParent(view.scrollDOM);
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const margin = view.defaultLineHeight * lines;
    const overBottom = coords.bottom + margin - rect.bottom;
    if (overBottom > 0) scroller.scrollTop += overBottom;
    const overTop = rect.top + margin - coords.top;
    if (overTop > 0) scroller.scrollTop -= overTop;
  });
}

/** First image file in a paste/drop payload, or null if there isn't one — lets the caller fall
 * back to CodeMirror's normal paste/drop handling for everything else (plain text, non-image
 * files). */
function findImageFile(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of data.files ?? []) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}

/** A clipboard payload that, trimmed, is *only* a bare `http(s)://` URL — not a URL sitting
 * inside a larger block of pasted text, which should paste as plain text like normal. */
const BARE_URL_RE = /^https?:\/\/\S+$/i;

/**
 * Fetches `url`'s page `<title>` and, if one came back, swaps the just-pasted raw URL text for a
 * proper `[title](url)` link — same "insert now, upgrade once the async bit resolves" shape as
 * `uploadAndInsert` below. Leaves the bare URL in place (a perfectly fine fallback, unlike the
 * image placeholder case) when the fetch fails or the page has no title.
 */
async function insertLinkWithTitle(view: EditorView, url: string): Promise<void> {
  const title = await api.linkTitle(url).catch(() => null);
  if (!title) return;
  const text = view.state.doc.toString();
  const idx = text.indexOf(url);
  if (idx === -1) return;
  const insert = `[${title}](${url})`;
  view.dispatch({
    changes: { from: idx, to: idx + url.length, insert },
    selection: { anchor: idx + insert.length },
  });
}

/**
 * Uploads `file` and swaps a placeholder for the real Markdown image link once it's done. The
 * placeholder is inserted immediately (at the drop/paste position) so there's instant feedback;
 * it's found again by plain text search rather than tracked position, which is simple and good
 * enough for a single-user tool — the edge case (two uploads producing byte-identical placeholder
 * text at the same moment) is accepted, not guarded against.
 */
async function uploadAndInsert(view: EditorView, file: File): Promise<void> {
  const placeholder = `![uploading ${file.name}…]()`;
  const pos = view.state.selection.main.head;
  view.dispatch({ changes: { from: pos, to: pos, insert: placeholder } });

  const replacePlaceholder = (markdown: string) => {
    const text = view.state.doc.toString();
    const idx = text.indexOf(placeholder);
    if (idx === -1) return;
    view.dispatch({ changes: { from: idx, to: idx + placeholder.length, insert: markdown } });
  };

  try {
    const { relPath } = await api.uploadAttachment(file);
    replacePlaceholder(`![${file.name}](${encodeURI(relPath)})`);
  } catch {
    replacePlaceholder('![upload failed]()');
  }
}

export interface MarkdownEditorHandle {
  getValue: () => string;
  /** 1-based line number the cursor (selection head) currently sits on. */
  getCursorLine: () => number;
  /** Inserts `text` as its own block right after the line the cursor is on, blank-line
   * separated, and moves the cursor to just after the inserted text. */
  insertAtCursor: (text: string) => void;
  /** Replaces the given 1-based inclusive line range wholesale with `text`. */
  replaceLines: (fromLine: number, toLine: number, text: string) => void;
  /** Moves the cursor to the start of the given 1-based line and scrolls it into view — the
   * editing-mode equivalent of the outline rail's `scrollIntoView` on a rendered heading, since
   * there's no rendered `<h1 id>` to scroll to while the raw markdown is what's on screen. */
  scrollToLine: (lineNumber: number) => void;
}

/**
 * Uncontrolled by design: `initialValue` seeds the document once on mount and is intentionally
 * not re-applied on later prop changes (CodeMirror owns the content from then on) — a controlled
 * `value` prop that round-trips through React state on every keystroke would fight CodeMirror's
 * own cursor/selection handling. The parent reads the live content via the ref's `getValue()`
 * (e.g. on Save) instead of listening for onChange.
 */
export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  {
    initialValue: string;
    onChange?: (value: string) => void;
    notes?: NoteSummary[];
    /** Ctrl/Cmd+Click on a `[[wikilink]]` that resolves to a real note calls this with its
     * relPath — same resolution `resolveWikilinkTarget` uses for the autocomplete-inserted
     * form. An unresolved target (typo, renamed/deleted note) just does nothing, same as a
     * plain click elsewhere in the document. */
    onOpenLink?: (relPath: string) => void;
    className?: string;
  }
>(function MarkdownEditor(
  {
    initialValue,
    onChange,
    notes,
    onOpenLink,
    className = 'h-[70vh] overflow-y-auto rounded-lg border border-slate-800',
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Kept in a ref (not a dependency the editor effect re-runs on) so a parent passing a fresh
  // `onChange` closure every render doesn't force the editor to be torn down and recreated.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  // Same reasoning as `onChangeRef`: the wikilink completion source reads this on every
  // keystroke via a closure, so a fresh `notes` array each render (e.g. after creating a note
  // elsewhere) is picked up live without tearing down and recreating the whole editor.
  const notesRef = useRef<NoteSummary[]>(notes ?? []);
  useEffect(() => {
    notesRef.current = notes ?? [];
  }, [notes]);
  const onOpenLinkRef = useRef(onOpenLink);
  useEffect(() => {
    onOpenLinkRef.current = onOpenLink;
  }, [onOpenLink]);

  useImperativeHandle(ref, () => ({
    getValue: () => viewRef.current?.state.doc.toString() ?? initialValue,
    getCursorLine: () => {
      const view = viewRef.current;
      if (!view) return 1;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    },
    insertAtCursor: (text: string) => {
      const view = viewRef.current;
      if (!view) return;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const insertText = `\n\n${text}\n`;
      view.dispatch({
        changes: { from: line.to, to: line.to, insert: insertText },
        selection: { anchor: line.to + insertText.length },
      });
      view.focus();
    },
    replaceLines: (fromLine: number, toLine: number, text: string) => {
      const view = viewRef.current;
      if (!view) return;
      const from = view.state.doc.line(fromLine).from;
      const to = view.state.doc.line(toLine).to;
      view.dispatch({ changes: { from, to, insert: text } });
      view.focus();
    },
    scrollToLine: (lineNumber: number) => {
      const view = viewRef.current;
      if (!view) return;
      const clamped = Math.min(Math.max(lineNumber, 1), view.state.doc.lines);
      const { from } = view.state.doc.line(clamped);
      view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
      view.focus();
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          history(),
          drawSelection(),
          autocompletion({ override: [wikilinkCompletionSource(() => notesRef.current)] }),
          // completionKeymap must be checked before defaultKeymap: defaultKeymap's own Enter
          // binding (insertNewlineAndIndent) always returns true regardless of whether a
          // completion popup is open, so if it were listed first it would swallow Enter/Escape/
          // arrow keys meant to accept or dismiss a suggestion instead of letting
          // completionKeymap's (popup-aware) handlers run first.
          keymap.of([...completionKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          scrollCursorMargin(5),
          ...liveMarkdownPreviewExtensions(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            mousedown(event, cmView) {
              const pos = cmView.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              const ctrlHeld = event.ctrlKey || event.metaKey;
              // Always require Ctrl/Cmd to open a link from inside the editor, whether or not
              // the click lands on the line you're actively editing — a plain click should
              // only ever place the cursor so you can keep typing, never whisk you away to
              // another note. (An earlier version let a plain click open a link sitting on an
              // *inactive* line, matching the read view, but that meant clicking onto a new
              // line to resume editing it could silently navigate away instead of landing the
              // cursor there — the "Ctrl+Click to open" tooltip on every link was also a lie
              // half the time. Matches real Obsidian's own live-preview click behavior.)
              if (!ctrlHeld) return false;

              const wikilinkTarget = wikilinkTargetAtPos(cmView.state, pos);
              if (wikilinkTarget !== null) {
                const relPath = resolveWikilinkTarget(notesRef.current, wikilinkTarget);
                if (!relPath) return false; // unresolved — nothing sensible to open
                event.preventDefault();
                onOpenLinkRef.current?.(relPath);
                return true;
              }

              const url = linkUrlAtPos(cmView.state, pos);
              if (!url) return false;
              event.preventDefault();
              window.open(url, '_blank', 'noopener,noreferrer');
              return true;
            },
            paste(event, cmView) {
              const file = findImageFile(event.clipboardData);
              if (file) {
                event.preventDefault();
                void uploadAndInsert(cmView, file);
                return true;
              }
              const text = event.clipboardData?.getData('text/plain').trim();
              if (text && BARE_URL_RE.test(text)) {
                event.preventDefault();
                const sel = cmView.state.selection.main;
                if (!sel.empty) {
                  // Pasting a URL over a selection links that selected text instead of
                  // replacing it — no title fetch needed, the label is already right there.
                  const label = cmView.state.sliceDoc(sel.from, sel.to);
                  const insert = `[${label}](${text})`;
                  cmView.dispatch({
                    changes: { from: sel.from, to: sel.to, insert },
                    selection: { anchor: sel.from + insert.length },
                  });
                } else {
                  cmView.dispatch({ changes: { from: sel.from, to: sel.to, insert: text } });
                  void insertLinkWithTitle(cmView, text);
                }
                return true;
              }
              return false;
            },
            drop(event, cmView) {
              const file = findImageFile(event.dataTransfer);
              if (!file) return false;
              event.preventDefault();
              void uploadAndInsert(cmView, file);
              return true;
            },
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className={className} />;
});
