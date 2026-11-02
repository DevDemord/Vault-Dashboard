const MIN_NOTE_WIDTH_REM = 36;
const MAX_NOTE_WIDTH_REM = 90;
const DEFAULT_NOTE_WIDTH_REM = 57.6;

/** A slim, always-visible status-bar strip (like Obsidian's own Editor Width Slider), docked to
 * the bottom of the main content column — not a floating overlay, so it's bounded within that
 * column and can never sit on top of the sidebars either side of it. */
export function ReadingWidthControl({ widthRem, onChange }: { widthRem: number; onChange: (rem: number) => void }) {
  return (
    <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-800/80 bg-slate-950/90 px-4 py-1.5 print:hidden">
      <span className="text-[11px] text-slate-500">Width</span>
      <input
        type="range"
        min={MIN_NOTE_WIDTH_REM}
        max={MAX_NOTE_WIDTH_REM}
        step={1}
        value={widthRem}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32 accent-violet-500"
      />
      <span className="w-12 text-right text-[11px] text-slate-500">{Math.round(widthRem * 16)}px</span>
      <button
        onClick={() => onChange(DEFAULT_NOTE_WIDTH_REM)}
        title="Reset to default width"
        className="text-[11px] text-violet-300 hover:text-violet-200"
      >
        Reset
      </button>
    </div>
  );
}
