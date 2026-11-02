/** Plain stroke-only line icons (no fill, `currentColor`) for the move/delete row actions shared
 * between the full Mail page and the home page's UnreadMailWidget — deliberately not emoji
 * (📁/🗑), which render in their own fixed multi-color glyph regardless of the button's text
 * color, clashing with the rest of a row's single-color, hover-tinted icon treatment (✓✓, ↻, ☐
 * all just inherit text color). */
export function FolderIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7a1 1 0 0 1 1-1h4.5l1.8 1.8a1 1 0 0 0 .7.3H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z" />
    </svg>
  );
}

/** A plain trash can (lid + two ridge lines), distinct from the folder icon's shape rather than
 * another variant of the same glyph family — same stroke-only, `currentColor` treatment. */
export function TrashIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
      <path d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

/** What the trash button turns into once armed — a plain checkmark, clicked to actually confirm
 * the delete (see the arm/confirm dance in `useMailRowActions`'s `handleTrashClick`). */
export function CheckIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
