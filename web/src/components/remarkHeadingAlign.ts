import { visit } from 'unist-util-visit';

const ALIGN_RE = /\s*\{\.(center|right)\}\s*$/;

/**
 * Reads a trailing `{.center}` / `{.right}` marker off a heading's own text — added by the
 * editor's "↔ Align" button in NoteView.tsx, not something anyone types by hand — and promotes it
 * into a hast `data-align` attribute instead of rendering it as literal text. Same pattern as
 * remarkObsidianCallouts promoting a callout's `[!type]` marker into an attribute rather than
 * rendering it.
 */
export function remarkHeadingAlign() {
  return (tree: unknown) => {
    visit(tree as never, 'heading', (node: any) => {
      const children = node.children;
      if (!children || children.length === 0) return;
      const last = children[children.length - 1];
      if (!last || last.type !== 'text') return;

      const match = ALIGN_RE.exec(last.value);
      if (!match) return;

      last.value = last.value.slice(0, match.index);
      if (!last.value) children.pop();

      node.data = {
        ...node.data,
        hProperties: { ...(node.data?.hProperties ?? {}), 'data-align': match[1] },
      };
    });
  };
}
