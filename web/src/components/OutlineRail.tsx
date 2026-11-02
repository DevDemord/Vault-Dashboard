import type { OutlineItem } from './outline';

/** Longer lines for bigger headings, flush right — a minimap-style ruler rather than a list of
 * labels, so it reads at a glance instead of needing to be opened first. */
const WIDTH_BY_LEVEL: Record<number, number> = { 1: 26, 2: 21, 3: 17, 4: 13, 5: 10, 6: 7 };
/** Thickness scales with level too — otherwise every tick is the same 2px tall and the shorter,
 * more-rounded ones read as visually "chunkier" than the long ones (an optical illusion from
 * rounded-full end-caps eating a bigger share of a short bar). Scaling height on purpose makes
 * bigger headings read as bolder instead of that being an accident of rounding. */
const HEIGHT_BY_LEVEL: Record<number, number> = { 1: 5, 2: 4.3, 3: 3.6, 4: 2.9, 5: 2.2, 6: 1.5 };

function jumpTo(slug: string): void {
  document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Always-visible outline rail for the single-note view — a sibling of the scrolling note pane
 * (not an overlay on top of it), so it naturally occupies the gutter between the note and the
 * Quick Links sidebar without needing to know that sidebar's own collapsed/expanded width. Hidden
 * below `md` where there's no room for a gutter at all. */
export function OutlineRail({
  outline,
  activeSlug,
  onJump,
}: {
  outline: OutlineItem[];
  activeSlug?: string | null;
  /** Tried first on click; only falls back to the default DOM `scrollIntoView` (which only finds
   * anything while the note is rendered, not while it's being edited) if this returns false or
   * isn't given at all. */
  onJump?: (slug: string) => boolean;
}) {
  if (outline.length < 2) return null;
  return (
    <div className="scroll-pane hidden w-9 flex-shrink-0 flex-col items-end gap-[6px] overflow-y-auto px-2 py-8 print:hidden md:flex">
      {outline.map((h) => (
        <button
          key={h.slug}
          onClick={() => {
            if (!onJump?.(h.slug)) jumpTo(h.slug);
          }}
          title={h.text}
          style={{ width: WIDTH_BY_LEVEL[h.level] ?? 7, height: HEIGHT_BY_LEVEL[h.level] ?? 2.5 }}
          className={`flex-shrink-0 rounded-full transition-colors ${
            h.slug === activeSlug ? 'bg-violet-400' : 'bg-slate-700 hover:bg-violet-400'
          }`}
        />
      ))}
    </div>
  );
}
