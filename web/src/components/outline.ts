export interface OutlineItem {
  level: number;
  text: string;
  slug: string;
  /** 1-based line number within the markdown passed in — lets a heading click jump the live
   * editor to that line when there's no rendered `<h1 id="slug">` to scroll to (editing mode). */
  line: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** Headings found in a note's rendered-markdown source, in document order, with GitHub-style
 * deduped slugs (`heading`, `heading-1`, `heading-2`, …) for scroll-to-anchor ids. The heading
 * overrides passed to `ReactMarkdown` consume this same array by index (not by re-deriving the
 * slug from the rendered element) so the two never disagree about which id belongs where. */
export function extractOutline(markdown: string): OutlineItem[] {
  const counts = new Map<string, number>();
  const items: OutlineItem[] = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (!m) continue;
    // Strip the editor's "↔ Align" marker (see remarkHeadingAlign.ts) so it doesn't show up in
    // the outline rail's hover text or get baked into the heading's slug.
    const text = m[2].trim().replace(/\s*\{\.(center|right)\}\s*$/, '');
    const base = slugify(text) || 'section';
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    items.push({ level: m[1].length, text, slug: n === 0 ? base : `${base}-${n}`, line: i + 1 });
  }
  return items;
}
