import { visit } from 'unist-util-visit';

const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)\s?(.*)$/;

/**
 * Recognizes Obsidian-style callouts (`> [!type] Title`, optionally `[!type]+`/`[!type]-` for
 * fold state, which is ignored here) and attaches `data-callout`/`data-callout-title` to the
 * blockquote's hast properties, stripping the marker line out of the rendered body so NoteView's
 * `blockquote` component can render a styled card instead of a plain quote.
 *
 * `[!multi-column]` is this vault's existing convention (via the Multi-Column Markdown Obsidian
 * plugin) for putting callouts side by side: a blockquote with no body of its own, whose children
 * are themselves nested callout blockquotes (`>>[!note] ...`), one per column. Since the marker
 * regex and stripping logic is identical at every nesting depth, a single pre-order `visit` over
 * all `blockquote` nodes handles the outer multi-column wrapper *and* each nested column callout
 * with the same pass — no special-casing for depth. NoteView's component then renders
 * `data-callout="multi-column"` as a flex row instead of a card, and each already-stripped nested
 * callout drops into it as one column.
 *
 * `[!code-columns]` is this dashboard's own convention (not an Obsidian plugin's), for the same
 * side-by-side layout but holding bare code blocks instead of callouts — no title bar, icon, or
 * colored border per column, just the code. Its nested blockquotes carry no `[!type]` header of
 * their own (there's nothing to label), so they can't be tagged by the generic header-matching
 * pass above — once a blockquote is identified as `code-columns`, its direct `blockquote`
 * children are force-tagged `data-callout="code-column"` below, skipping the header check
 * entirely. This runs pre-order (parent before children), so by the time this same visitor
 * reaches those children on its own turn, they already carry the tag and the generic check's
 * early-return (no header paragraph to match) leaves it untouched.
 */
export function remarkObsidianCallouts() {
  return (tree: unknown) => {
    visit(tree as never, 'blockquote', (node: any) => {
      const first = node.children?.[0];
      if (!first || first.type !== 'paragraph') return;
      const firstChild = first.children?.[0];
      if (!firstChild || firstChild.type !== 'text') return;

      const text: string = firstChild.value;
      const newlineIdx = text.indexOf('\n');
      const firstLine = newlineIdx === -1 ? text : text.slice(0, newlineIdx);
      const match = CALLOUT_RE.exec(firstLine.trim());
      if (!match) return;

      const [, type, , title] = match;
      const rest = newlineIdx === -1 ? '' : text.slice(newlineIdx + 1);

      if (rest) {
        firstChild.value = rest;
      } else if (first.children.length > 1) {
        first.children.shift();
      } else {
        node.children.shift();
      }

      node.data = {
        ...node.data,
        hProperties: {
          ...(node.data?.hProperties ?? {}),
          'data-callout': type.toLowerCase(),
          'data-callout-title': title || type,
        },
      };

      if (type.toLowerCase() === 'code-columns') {
        for (const child of node.children) {
          if (child.type !== 'blockquote') continue;
          child.data = {
            ...child.data,
            hProperties: { ...(child.data?.hProperties ?? {}), 'data-callout': 'code-column' },
          };
        }
      }
    });
  };
}
