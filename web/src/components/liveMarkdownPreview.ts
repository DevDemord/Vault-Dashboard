import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type EditorState,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';

/**
 * Obsidian-style "live preview": markdown syntax marks (`#`, `**`, `` ` ``, etc.) are hidden and
 * their surrounding text is styled to look like the rendered result, *except* on whatever line
 * the cursor/selection currently touches — there, the raw syntax is shown so it stays editable.
 * Built on the same Lezer markdown parser `@codemirror/lang-markdown` already wraps, walked once
 * per visible-range on every doc/selection change (cheap for note-sized documents).
 */

const HEADING_NODE_RE = /^ATXHeading([1-6])$/;
/** Obsidian's internal-link syntax — not something `@lezer/markdown` (even with GFM) parses as
 * its own node, so unlike every other decoration in this file, wikilinks are found by scanning
 * each visible range's raw text directly rather than walking the syntax tree. Doesn't support
 * the `[[target|alias]]`/`[[target#heading]]` forms specially (the whole inner text between the
 * brackets is shown as-is) — the autocomplete feature that inserts these only ever writes the
 * plain `[[Title]]` form, so that's the only shape worth polishing here. */
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;

export function isLineActive(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return state.selection.ranges.some((r) => {
    const fromLine = state.doc.lineAt(r.from).number;
    const toLine = state.doc.lineAt(r.to).number;
    return line.number >= fromLine && line.number <= toLine;
  });
}

/** True if `pos` sits inside an inline-code span or fenced code block — a literal `[[...]]`
 * written there is code text, not a real link, and should be left completely alone (no hidden
 * brackets, no `.cm-wikilink` styling, no click handling). */
function isInsideCode(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  while (node) {
    if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeText') return true;
    node = node.parent;
  }
  return false;
}

const hideMark = Decoration.replace({});

/** Toggles whether the fenced code block starting at the given document position (its
 * `FencedCode` node's `.from`) is collapsed. Keyed by position rather than an index/id since
 * there's nothing else stable to key a code block by — positions shift on edits, but the state
 * field below is rebuilt fresh from the current syntax tree's folded-or-not check every time
 * decorations are recomputed, so a stale position just stops matching anything instead of folding
 * the wrong block. */
const toggleCodeFold = StateEffect.define<number>();

const codeFoldState = StateField.define<ReadonlySet<number>>({
  create: () => new Set(),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (!e.is(toggleCodeFold)) continue;
      const copy = new Set(next);
      if (copy.has(e.value)) copy.delete(e.value);
      else copy.add(e.value);
      next = copy;
    }
    return next;
  },
});

/** Small ▾/▸ control on a fenced code block's opening fence line — click to collapse/expand.
 * Placed as a widget (not a gutter icon) since this editor hides its gutters entirely for the
 * live-preview look. */
class FoldToggleWidget extends WidgetType {
  constructor(
    readonly pos: number,
    readonly folded: boolean,
  ) {
    super();
  }
  eq(other: FoldToggleWidget) {
    return other.pos === this.pos && other.folded === this.folded;
  }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-code-fold-toggle';
    span.textContent = this.folded ? '▸' : '▾';
    span.title = this.folded ? 'Expand code block' : 'Collapse code block';
    span.onmousedown = (event) => {
      event.preventDefault();
      view.dispatch({ effects: toggleCodeFold.of(this.pos) });
    };
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

/** A GFM task-list marker (`[ ]` / `[x]`), rendered as an actual clickable checkbox instead of
 * literal bracket text — click toggles the single state character in the document (the 2nd of
 * the marker's 3 characters, per `TaskParser` in `@lezer/markdown`) between `' '` and `'x'`. */
class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly statePos: number,
    readonly checked: boolean,
  ) {
    super();
  }
  eq(other: TaskCheckboxWidget) {
    return other.statePos === this.statePos && other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-task-checkbox';
    input.checked = this.checked;
    input.onmousedown = (event) => {
      event.preventDefault();
      view.dispatch({
        changes: { from: this.statePos, to: this.statePos + 1, insert: this.checked ? ' ' : 'x' },
      });
    };
    return input;
  }
  ignoreEvent() {
    return true;
  }
}

/** A `---`/`***`/`___` thematic break, rendered as an actual horizontal rule instead of literal
 * dashes — replaces the whole line's text since a `HorizontalRule` node is never anything else
 * on its line. Shown as raw text instead whenever the cursor is on that line, same convention as
 * every other hidden-when-blurred mark here, so there's still something to click into and edit. */
class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const div = document.createElement('div');
    div.className = 'cm-hr';
    return div;
  }
  ignoreEvent() {
    return true;
  }
}

/** An inline `![alt](url)` image, rendered as an actual `<img>` thumbnail instead of literal
 * markdown — replaces the whole `Image` node's text whenever its line isn't the active one, same
 * hide-while-active convention as everything else here. `url` is whatever the markdown already
 * contains verbatim: `uploadAndInsert` (`MarkdownEditor.tsx`) writes a bare vault-relative path
 * (e.g. `_Attachments/foo.png`), which isn't directly fetchable, so anything that doesn't already
 * look like an absolute URL gets routed through the same `/api/attachments/<path>` endpoint the
 * read view's resolved image embeds use. */
class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt;
  }
  toDOM() {
    const src = /^(https?:)?\/\//i.test(this.url) || this.url.startsWith('/api/')
      ? this.url
      : `/api/attachments/${this.url}`;
    const img = document.createElement('img');
    img.className = 'cm-image-embed';
    img.src = src;
    img.alt = this.alt;
    return img;
  }
  ignoreEvent() {
    return true;
  }
}

/** Stand-in for a collapsed code block's hidden body — just enough to show something was folded
 * and how much, with no interaction of its own (clicking the ▸ toggle above it re-expands). */
class FoldedPlaceholderWidget extends WidgetType {
  constructor(readonly lineCount: number) {
    super();
  }
  eq(other: FoldedPlaceholderWidget) {
    return other.lineCount === this.lineCount;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-code-fold-placeholder';
    span.textContent = `⋯ ${this.lineCount} line${this.lineCount === 1 ? '' : 's'} hidden`;
    return span;
  }
}

/**
 * Collects into a plain array and sorts at the end (`Decoration.set(arr, true)`) rather than
 * `RangeSetBuilder`'s streaming `.add()` — a parent node's full-range mark (e.g. a bold span) and
 * its child's mark-hiding decoration (the `**`) legitimately start at the *same* position, and
 * `RangeSetBuilder` requires strictly sorted insertion (by `from`, then `startSide`) and throws
 * "Ranges must be added sorted by `from` position and `startSide`" the moment that's violated —
 * confirmed by actually reproducing it in a headless CodeMirror instance before landing this fix,
 * since the symptom in the browser was silent (CodeMirror catches the throw, disables the plugin,
 * and the editor just looks like plain text with no visible error).
 */
function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const { state } = view;
  const foldedBlocks = state.field(codeFoldState);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const headingMatch = HEADING_NODE_RE.exec(node.name);
        if (headingMatch) {
          const line = state.doc.lineAt(node.from);
          decorations.push(Decoration.line({ class: `cm-heading cm-heading-${headingMatch[1]}` }).range(line.from));
          return;
        }

        switch (node.name) {
          case 'HeaderMark': {
            if (!isLineActive(state, node.from)) {
              // swallow the trailing space after e.g. "##" too, so hidden marks don't leave a gap
              const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
              decorations.push(hideMark.range(node.from, end));
            }
            break;
          }
          case 'StrongEmphasis':
            decorations.push(Decoration.mark({ class: 'cm-strong' }).range(node.from, node.to));
            break;
          case 'Emphasis':
            decorations.push(Decoration.mark({ class: 'cm-emphasis' }).range(node.from, node.to));
            break;
          case 'Strikethrough':
            decorations.push(Decoration.mark({ class: 'cm-strikethrough' }).range(node.from, node.to));
            break;
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isLineActive(state, node.from)) decorations.push(hideMark.range(node.from, node.to));
            break;
          case 'InlineCode':
            decorations.push(Decoration.mark({ class: 'cm-inline-code' }).range(node.from, node.to));
            break;
          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode') {
              // The single backticks around `inline code` — hide like any other inline mark.
              if (!isLineActive(state, node.from)) decorations.push(hideMark.range(node.from, node.to));
            } else if (node.node.parent?.name === 'FencedCode') {
              // The ``` fence lines — kept visible (not hidden, unlike inline marks) since this is
              // a multi-line construct and hiding just the fence text would leave a confusing gap
              // rather than collapsing the line; muting them instead marks them as "block chrome"
              // distinct from the actual code content, which the line decoration below styles.
              decorations.push(Decoration.mark({ class: 'cm-code-fence-mark' }).range(node.from, node.to));
            }
            break;
          case 'CodeInfo':
            // The language tag on the opening fence line, e.g. "js" in ```js — same muted styling.
            decorations.push(Decoration.mark({ class: 'cm-code-fence-mark' }).range(node.from, node.to));
            break;
          case 'FencedCode': {
            // A full-width background band on every line of the block (not just a mark hugging the
            // text) so it actually reads as a bounded code box, not just "the ``` is still there."
            const startLine = state.doc.lineAt(node.from).number;
            const endLine = state.doc.lineAt(node.to).number;
            const isFolded = foldedBlocks.has(node.from);
            decorations.push(Decoration.line({ class: 'cm-code-fence-line' }).range(state.doc.line(startLine).from));
            decorations.push(Decoration.line({ class: 'cm-code-fence-line' }).range(state.doc.line(endLine).from));
            decorations.push(
              Decoration.widget({ widget: new FoldToggleWidget(node.from, isFolded), side: -1 }).range(
                state.doc.line(startLine).from,
              ),
            );
            // The actual hidden-body placeholder for a folded block is NOT built here — see
            // `foldPlaceholderDecorations` below. CodeMirror requires block-level decorations
            // (this one replaces whole lines, including their line breaks) to come from a plain
            // state-based facet provider, not a `ViewPlugin` like this one; this plugin may only
            // contribute the inline/line-attribute decorations below.
            if (!isFolded) {
              for (let n = startLine + 1; n < endLine; n++) {
                decorations.push(Decoration.line({ class: 'cm-code-line' }).range(state.doc.line(n).from));
              }
            }
            break;
          }
          case 'HorizontalRule':
            if (!isLineActive(state, node.from)) {
              decorations.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to));
            }
            break;
          case 'Image': {
            if (isLineActive(state, node.from)) break; // raw `![alt](url)` stays editable
            const marks = node.node.getChildren('LinkMark');
            const urlNode = node.node.getChild('URL');
            // `marks` is always `!` `[`, `]`, `(`, `)` for a well-formed image — bail to raw text
            // for anything else (e.g. still mid-typing, no closing `)` yet) rather than guess.
            if (marks.length < 4 || !urlNode) break;
            const alt = state.sliceDoc(marks[0].to, marks[1].from);
            const url = state.sliceDoc(urlNode.from, urlNode.to);
            decorations.push(Decoration.replace({ widget: new ImageWidget(url, alt) }).range(node.from, node.to));
            break;
          }
          case 'Blockquote': {
            const startLine = state.doc.lineAt(node.from).number;
            const endLine = state.doc.lineAt(node.to).number;
            for (let n = startLine; n <= endLine; n++) {
              decorations.push(Decoration.line({ class: 'cm-quote-line' }).range(state.doc.line(n).from));
            }
            break;
          }
          case 'ListMark':
            decorations.push(Decoration.mark({ class: 'cm-list-mark' }).range(node.from, node.to));
            break;
          case 'Link':
            // Styled unconditionally (like StrongEmphasis above) — only the bracket/paren/URL
            // marks below get hidden-on-blur; the link text itself always looks like a link.
            decorations.push(
              Decoration.mark({ class: 'cm-link', attributes: { title: 'Ctrl+Click to open' } }).range(
                node.from,
                node.to,
              ),
            );
            break;
          case 'LinkMark':
            if (node.node.parent?.name === 'Link' && !isLineActive(state, node.from)) {
              decorations.push(hideMark.range(node.from, node.to));
            }
            break;
          case 'URL':
            if (node.node.parent?.name === 'Link') {
              if (!isLineActive(state, node.from)) decorations.push(hideMark.range(node.from, node.to));
            } else if (node.node.parent?.name !== 'Image') {
              // A bare autolink (`https://…` with no `[text](...)` wrapper) — there's no
              // separate label to show instead, so just style the raw URL as a link. (An
              // `Image`-parented URL is left alone: it's either raw text on the active line, or
              // already hidden inside the `Image` case's widget replacement above.)
              decorations.push(
                Decoration.mark({ class: 'cm-link', attributes: { title: 'Ctrl+Click to open' } }).range(
                  node.from,
                  node.to,
                ),
              );
            }
            break;
          case 'TaskMarker': {
            // 3-char span: "[ ]" or "[x]" — the state char sits at index 1.
            const checked = /[xX]/.test(state.doc.sliceString(node.from + 1, node.from + 2));
            decorations.push(
              Decoration.replace({ widget: new TaskCheckboxWidget(node.from + 1, checked) }).range(
                node.from,
                node.to,
              ),
            );
            break;
          }
          default:
            break;
        }
      },
    });

    // Wikilinks aren't a syntax-tree node (see `WIKILINK_RE`'s comment) — scanned separately,
    // over the same visible-range text, rather than inside the `iterate` callback above.
    const text = state.doc.sliceString(from, to);
    for (const m of text.matchAll(WIKILINK_RE)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      if (isInsideCode(state, start)) continue;
      const innerFrom = start + 2;
      const innerTo = end - 2;
      decorations.push(
        Decoration.mark({ class: 'cm-wikilink', attributes: { title: 'Ctrl+Click to open' } }).range(
          innerFrom,
          innerTo,
        ),
      );
      if (!isLineActive(state, start)) {
        decorations.push(hideMark.range(start, innerFrom));
        decorations.push(hideMark.range(innerTo, end));
      }
    }
  }

  return Decoration.set(decorations, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.field(codeFoldState) !== update.state.field(codeFoldState)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** The collapsed-block placeholder, split out from `livePreviewPlugin` above for one specific
 * reason: it's a block decoration (it replaces whole lines, including their line breaks), and
 * CodeMirror flatly refuses those from a `ViewPlugin` — `EditorView.decorations.compute(...)` is
 * the one other place block decorations are allowed to come from, computed straight from state
 * rather than from a live view. Re-runs whenever the doc or the folded-block set changes. */
const foldPlaceholderDecorations = EditorView.decorations.compute(['doc', codeFoldState], (state) => {
  const foldedBlocks = state.field(codeFoldState);
  if (foldedBlocks.size === 0) return Decoration.none;
  const decorations: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode' || !foldedBlocks.has(node.from)) return;
      const startLine = state.doc.lineAt(node.from).number;
      const endLine = state.doc.lineAt(node.to).number;
      if (endLine <= startLine + 1) return; // nothing between the fences to hide
      const from = state.doc.line(startLine + 1).from;
      const to = state.doc.line(endLine - 1).to;
      decorations.push(
        Decoration.replace({ widget: new FoldedPlaceholderWidget(endLine - startLine - 1), block: true }).range(
          from,
          to,
        ),
      );
    },
  });
  return Decoration.set(decorations, true);
});

/** Pressing Enter right after typing an opening ` ``` ` (optionally with a language tag, e.g.
 * ` ```js `) auto-inserts the closing fence with a blank line in between and drops the cursor on
 * that blank line — so starting a code block is "type the fence, hit Enter, start typing code"
 * instead of also having to type the closing fence yourself and arrow back up to it. Only fires
 * for a line that's *exactly* a bare fence marker (nothing else on it) and only when it's opening
 * a new block rather than closing one already open — determined by counting fence-marker lines
 * above it: an even count means we're not currently inside a block, so this one is an opener.
 * Deliberately keyed off Enter rather than the 3rd backtick itself, so typing a language tag
 * (` ```js `) right after the fence still works normally — triggering on the bare 3rd backtick
 * would yank the cursor onto a new line before "js" could be typed. Wrapped in `Prec.highest` so
 * it's checked before `defaultKeymap`'s own Enter binding (added earlier, at lower precedence, in
 * MarkdownEditor.tsx) rather than losing to it outright. */
function handleFenceEnter(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.to) return false;
  if (!/^```[a-zA-Z0-9_-]*$/.test(line.text)) return false;

  let fenceLinesAbove = 0;
  for (let n = 1; n < line.number; n++) {
    if (/^```/.test(state.doc.line(n).text)) fenceLinesAbove++;
  }
  if (fenceLinesAbove % 2 !== 0) return false; // this line closes an already-open fence

  const insertPos = line.to;
  view.dispatch({
    changes: { from: insertPos, to: insertPos, insert: '\n\n```' },
    selection: EditorSelection.cursor(insertPos + 1),
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

const autoCloseFence = Prec.highest(keymap.of([{ key: 'Enter', run: handleFenceEnter }]));

const theme = EditorView.theme(
  {
    '&': { backgroundColor: '#0f172a', color: '#e2e8f0', height: '100%' },
    '.cm-content': {
      padding: '16px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '14px',
      lineHeight: '1.7',
      caretColor: '#c4b5fd',
    },
    '.cm-scroller': { overflow: 'auto' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#c4b5fd' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(139,92,246,0.25) !important',
    },
    '.cm-gutters': { display: 'none' },
    // A unitless `lineHeight` (rather than inheriting `.cm-content`'s fixed `1.7`) scales with
    // each level's own font-size instead of the much smaller base size, so a 2em heading line
    // doesn't end up cramped under a line-height computed for 14px body text.
    '.cm-heading': { fontWeight: '700', color: '#f8fafc', fontFamily: '"Rajdhani", sans-serif', lineHeight: '1.3' },
    '.cm-heading-1': { fontSize: '2em' },
    '.cm-heading-2': { fontSize: '1.7em' },
    '.cm-heading-3': { fontSize: '1.4em' },
    '.cm-heading-4': { fontSize: '1.2em' },
    // 5/6 match (or sit below) body size in raw em terms — same problem the read view's
    // `.prose-note h5`/`h6` had — so they lean on uppercase/letter-spacing instead, not size, to
    // still read as a heading rather than a slightly-bold line of body text.
    '.cm-heading-5': {
      fontSize: '1em',
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: '#cbd5e1',
    },
    '.cm-heading-6': {
      fontSize: '0.9em',
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: '#94a3b8',
    },
    '.cm-strong': { fontWeight: '700', color: '#f8fafc' },
    '.cm-emphasis': { fontStyle: 'italic' },
    '.cm-strikethrough': { textDecoration: 'line-through', opacity: '0.7' },
    '.cm-inline-code': {
      fontFamily: 'ui-monospace, monospace',
      backgroundColor: '#1e293b',
      color: '#c4b5fd',
      padding: '0 4px',
      borderRadius: '4px',
    },
    '.cm-code-line, .cm-code-fence-line': {
      fontFamily: 'ui-monospace, monospace',
      backgroundColor: '#1e293b',
    },
    '.cm-code-fence-mark': { color: '#64748b' },
    '.cm-code-fold-toggle': {
      display: 'inline-block',
      width: '1ch',
      marginRight: '4px',
      color: '#64748b',
      cursor: 'pointer',
      userSelect: 'none',
    },
    '.cm-code-fold-toggle:hover': { color: '#c4b5fd' },
    '.cm-code-fold-placeholder': {
      display: 'inline-block',
      fontFamily: 'ui-monospace, monospace',
      fontStyle: 'italic',
      color: '#64748b',
      backgroundColor: '#1e293b',
      padding: '2px 8px',
      borderRadius: '4px',
    },
    '.cm-quote-line': {
      borderLeft: '2px solid rgba(139, 92, 246, 0.5)',
      paddingLeft: '8px',
      color: '#94a3b8',
    },
    '.cm-list-mark': { color: '#a78bfa' },
    '.cm-hr': {
      display: 'inline-block',
      width: '100%',
      height: '1px',
      verticalAlign: 'middle',
      backgroundColor: '#334155',
    },
    '.cm-link': {
      color: '#22d3ee',
      textDecoration: 'underline',
      textDecorationColor: 'rgba(34,211,238,0.4)',
      cursor: 'pointer',
    },
    '.cm-image-embed': {
      display: 'block',
      maxWidth: '100%',
      maxHeight: '320px',
      borderRadius: '8px',
      margin: '4px 0',
    },
    // Violet, not cyan — echoes the read view's `.internal-link`/`.external-link` split
    // (index.css) so an internal `[[wikilink]]` reads as visually distinct from a regular `.cm-link`
    // right there in the editor, the same way it does once rendered.
    '.cm-wikilink': {
      color: '#a78bfa',
      textDecoration: 'underline',
      textDecorationColor: 'rgba(167,139,250,0.4)',
      cursor: 'pointer',
    },
    '.cm-task-checkbox': {
      verticalAlign: 'middle',
      marginRight: '6px',
      width: '14px',
      height: '14px',
      cursor: 'pointer',
      accentColor: '#8b5cf6',
    },
    // The `[[wikilink` autocomplete tooltip — CodeMirror renders tooltips into their own DOM
    // node outside the editor's own root, but still tags it with this view's theme class, so
    // these rules reach it the same way everything above reaches `.cm-content`. Without this,
    // `@codemirror/autocomplete`'s *default* theme is a plain white box that clashes hard with
    // the rest of this dark-themed editor.
    '.cm-tooltip': {
      border: '1px solid #334155',
      backgroundColor: '#1e293b',
      borderRadius: '8px',
    },
    '.cm-tooltip-autocomplete ul li': { color: '#e2e8f0' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'rgba(139,92,246,0.25)',
      color: '#f8fafc',
    },
    '.cm-completionLabel': { color: 'inherit' },
    '.cm-completionDetail': { color: '#64748b', fontStyle: 'normal', marginLeft: '8px' },
    '.cm-completionMatchedText': { color: '#c4b5fd', textDecoration: 'none' },
  },
  { dark: true },
);

/** The href a Ctrl/Cmd+Click at `pos` should open — the nearest enclosing `Link`'s `URL` child
 * (`pos` usually lands in the link *text*, not the href itself, since the href is hidden), or
 * the bare autolink's own text if `pos` sits directly on one — or `null` outside any link. */
export function linkUrlAtPos(state: EditorState, pos: number): string | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  while (node && node.name !== 'Link' && node.name !== 'URL') {
    node = node.parent;
  }
  if (!node) return null;
  const urlNode = node.name === 'URL' ? node : node.getChild('URL');
  if (!urlNode) return null;
  return state.doc.sliceString(urlNode.from, urlNode.to).replace(/^<|>$/g, '');
}

/** The raw inner text of whatever `[[wikilink]]` spans `pos` (trimmed, not yet resolved to a
 * note — see `resolveWikilinkTarget` in `wikilinkCompletion.ts` for that), or `null` outside any
 * wikilink. Only checks `pos`'s own line, same scope as how a click position works — a wikilink
 * can't span multiple lines in the first place. */
export function wikilinkTargetAtPos(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  for (const m of line.text.matchAll(WIKILINK_RE)) {
    const start = line.from + m.index!;
    const end = start + m[0].length;
    if (pos >= start && pos <= end) return m[1].trim();
  }
  return null;
}

/** Full extension set for a live-preview markdown editor: GFM-flavored markdown parsing, the
 * decoration plugin above, and the matching dark theme. Combine with history/keymap extensions
 * in the component that creates the `EditorState`. */
export function liveMarkdownPreviewExtensions(): Extension[] {
  return [
    markdown({ extensions: [GFM] }),
    codeFoldState,
    autoCloseFence,
    livePreviewPlugin,
    foldPlaceholderDecorations,
    theme,
    EditorView.lineWrapping,
  ];
}
