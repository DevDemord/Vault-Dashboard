import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { NoteSummary } from '../types';

const MAX_RESULTS = 15;

/**
 * Powers `[[wikilink` autocomplete. `matchBefore` anchors its search to the nearest preceding
 * `[[` that has no `]` between it and the cursor — so `[[Done]] then [[Pla` correctly resolves
 * to the second, still-open one, not the first. An empty query (just typed `[[`) shows the most
 * recently edited notes, same "what's fresh" glance as the sidebar's own recent-notes list;
 * typing further filters to titles starting with the typed text, case-insensitively — a plain
 * prefix match, not a fuzzy one, since that's literally what was asked for.
 *
 * `filter: false` on the returned result is required, not optional: CodeMirror's autocomplete
 * otherwise re-filters our `options` by fuzzy-matching each `label` against the matched span text
 * (which still includes the leading `[[`) — since no real note title contains "[[", that would
 * silently zero out every result.
 *
 * Inserted links use the plain `[[Title]]` form with no alias, matching the only other place this
 * codebase writes a wikilink programmatically (`vault.ts`'s Project/Area frontmatter fields) —
 * not a title/filename alias split, since in practice a note's title and filename only ever
 * diverge if someone hand-edits frontmatter, an edge case this app doesn't otherwise guard either.
 */
export function wikilinkCompletionSource(getNotes: () => NoteSummary[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[[^\]\n]*/);
    if (!match) return null;

    const query = match.text.slice(2).trim().toLowerCase();
    const notes = getNotes();
    const candidates = query
      ? notes.filter((n) => n.title.toLowerCase().startsWith(query))
      : [...notes].sort((a, b) => b.mtime - a.mtime);

    return {
      from: match.from,
      filter: false,
      options: candidates.slice(0, MAX_RESULTS).map((note) => ({
        label: note.title,
        detail: note.folder || undefined,
        apply: (view, _completion, from, to) => {
          const insert = `[[${note.title}]]`;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          });
        },
      })),
    };
  };
}

/**
 * Mirrors the server's own `resolveNote` (`vault.ts`) closely enough for click-to-open purposes:
 * matches by `relPath` (with or without a trailing `.md`, so a wikilink naming a nested path
 * like `4. Resources/Gaming/Plan` still resolves) first, then by filename basename
 * case-insensitively — deliberately never by the note's `title` field, since that can diverge
 * from its filename (a hand-edited frontmatter override) while the server's own rendering always
 * resolves wikilinks by filename, not title; matching title here instead could open a different
 * note than clicking the equivalent rendered link in read mode would. Strips a trailing
 * `|alias`/`#heading` first, same as the server's `splitTarget`. Returns `null` if nothing
 * resolves — same "unresolved" outcome the rendered view shows as a dashed, inert link.
 */
export function resolveWikilinkTarget(notes: NoteSummary[], rawTarget: string): string | null {
  const cleaned = rawTarget.split('|')[0].split('#')[0].trim().replace(/\.md$/i, '');
  if (!cleaned) return null;

  const direct = notes.find((n) => n.relPath === cleaned || n.relPath === `${cleaned}.md`);
  if (direct) return direct.relPath;

  const lower = cleaned.toLowerCase();
  const byBasename = notes.find((n) => {
    const base = n.relPath.slice(n.relPath.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    return base.toLowerCase() === lower;
  });
  return byBasename?.relPath ?? null;
}
