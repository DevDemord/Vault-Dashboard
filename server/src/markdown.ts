import type { NoteLink } from './types.js';

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;
const EMBED_RE = /!\[\[([^\]]+)\]\]/g;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
const INLINE_TAG_RE = /(?:^|\s)#([a-zA-Z0-9_\-/]+)/g;
const MD_IMAGE_RE = /!\[([^\]]*)\]\((?!https?:\/\/|\/api\/)([^)]+)\)/g;
const CHECKBOX_LINE_RE = /^\s*[-*]\s*\[([ xX])\]\s*(.+)$/;
const HEADING_RE = /^#{1,6}\s+(.+)$/;
const BARE_URL_RE = /^(https?:\/\/\S+)$/;
// A plain (non-checkbox) bullet starting with a date, optionally followed by a time — e.g.
// "- 2026-10-20 19:30 Lakers vs Celtics" or "- 2026-11-02 Mexico Grand Prix". An optional
// "..YYYY-MM-DD[ HH:MM]" suffix after the start date/time marks a multi-day span (a race weekend,
// a multi-day tournament) — e.g. "- 2026-10-23..2026-10-25 F1 - Austin". An optional trailing
// "#tag" (same inline-tag convention as the rest of the vault) marks which sport/series the event
// belongs to, for per-sport coloring — e.g. "- 2026-10-23 F1 - Austin #f1". The title group is
// lazy so a trailing "#tag" is only pulled out when one is actually present at the end of the line.
const SPORTS_EVENT_LINE_RE =
  /^\s*[-*]\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?(?:\s*\.\.\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?)?\s+(.+?)(?:\s+#([a-zA-Z0-9_-]+))?$/;

function splitTarget(raw: string): { target: string; alias?: string } {
  const [targetPart, aliasPart] = raw.split('|');
  return { target: targetPart.split('#')[0].trim(), alias: aliasPart?.trim() };
}

export function extractInlineTags(body: string): string[] {
  const tags = new Set<string>();
  for (const m of body.matchAll(INLINE_TAG_RE)) tags.add(m[1].toLowerCase());
  return [...tags];
}

export function extractWikiLinks(body: string): { raw: string; target: string; alias: string }[] {
  const links: { raw: string; target: string; alias: string }[] = [];
  for (const m of body.matchAll(WIKILINK_RE)) {
    const target = m[1].trim();
    const alias = (m[2] ?? target).trim();
    links.push({ raw: m[0], target, alias });
  }
  return links;
}

export function makeExcerpt(body: string, length = 180): string {
  const plain = body
    .replace(EMBED_RE, '')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t, a) => a ?? t)
    .replace(/[#*_`>~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > length ? plain.slice(0, length).trim() + '…' : plain;
}

/**
 * Rewrites Obsidian wikilink/embed syntax into plain Markdown the client's
 * react-markdown can render: internal note links become `obsidian://note/<path>`
 * (resolved) or `obsidian://unresolved/<name>` hrefs for the custom link
 * renderer, and image embeds become `/api/attachments/<path>` image syntax.
 */
export function transformBody(
  body: string,
  resolveNote: (name: string) => string | null,
  resolveAttachment: (name: string) => string | null,
): string {
  let out = body.replace(EMBED_RE, (_m, raw: string) => {
    const { target } = splitTarget(raw);
    if (IMAGE_EXT.test(target)) {
      const attPath = resolveAttachment(target);
      if (attPath) return `![${target}](/api/attachments/${encodeURIComponent(attPath)})`;
      return `*[missing attachment: ${target}]*`;
    }
    const notePath = resolveNote(target);
    return notePath
      ? `\n> 📄 **Embedded note:** [${target}](obsidian://note/${encodeURIComponent(notePath)})\n`
      : `\n> 📄 *Embedded note not found: ${target}*\n`;
  });

  out = out.replace(WIKILINK_RE, (_m, rawTarget: string, aliasPart?: string) => {
    const target = rawTarget.trim();
    const alias = (aliasPart ?? target).trim();
    const notePath = resolveNote(target);
    return notePath
      ? `[${alias}](obsidian://note/${encodeURIComponent(notePath)})`
      : `[${alias}](obsidian://unresolved/${encodeURIComponent(target)})`;
  });

  out = out.replace(MD_IMAGE_RE, (full, alt: string, src: string) => {
    if (src.startsWith('obsidian://')) return full;
    const attPath = resolveAttachment(decodeURIComponent(src));
    return attPath ? `![${alt}](/api/attachments/${encodeURIComponent(attPath)})` : full;
  });

  return out;
}

interface RawChecklistItem {
  done: boolean;
  text: string;
  group: string | null;
  url: string | null;
  line: number;
}

/**
 * Finds every `- [ ] ...` / `- [x] ...` line in a note body. A line whose text,
 * once its inline `#tags` are stripped, is nothing but a bare URL is flagged
 * with that `url` (the bookmark case); everything else is a plain task.
 * `group` is the nearest preceding Markdown heading, for date-grouping tasks.
 * `line` is the item's 0-based line number within `body`, so a checkbox can be
 * located again later (see `VaultIndex.toggleTask`) to flip it in place.
 */
export function extractChecklistItems(body: string): RawChecklistItem[] {
  const items: RawChecklistItem[] = [];
  let currentGroup: string | null = null;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(HEADING_RE);
    if (heading) {
      currentGroup = heading[1].trim();
      continue;
    }
    const m = line.match(CHECKBOX_LINE_RE);
    if (!m) continue;
    const done = m[1].toLowerCase() === 'x';
    const rawText = m[2].trim();
    const stripped = rawText.replace(INLINE_TAG_RE, ' ').trim();
    const urlMatch = stripped.match(BARE_URL_RE);
    items.push({ done, text: rawText, group: currentGroup, url: urlMatch ? urlMatch[1] : null, line: i });
  }
  return items;
}

/** Plain `- YYYY-MM-DD[ HH:MM][..YYYY-MM-DD[ HH:MM]] Title [#tag]` bullets from the dedicated
 * sports-events note — deliberately not checkbox items (nothing to tick off; an event just
 * passes). The `..`-suffixed end date/time is optional, for events spanning more than one day
 * (a race weekend, a multi-day tournament); `endDate`/`endTime` are null for a plain single-day
 * event. The trailing `#tag` is optional too, and is what drives per-sport coloring client-side;
 * `sport` is null (no color override) for an untagged event. `line` is the 0-based line number
 * within this body, same convention `extractChecklistItems` uses. */
export function extractSportsEvents(body: string): {
  date: string;
  time: string | null;
  endDate: string | null;
  endTime: string | null;
  sport: string | null;
  title: string;
  line: number;
}[] {
  const items: {
    date: string;
    time: string | null;
    endDate: string | null;
    endTime: string | null;
    sport: string | null;
    title: string;
    line: number;
  }[] = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SPORTS_EVENT_LINE_RE);
    if (!m) continue;
    items.push({
      date: m[1],
      time: m[2] ?? null,
      endDate: m[3] ?? null,
      endTime: m[4] ?? null,
      sport: m[6] ? m[6].toLowerCase() : null,
      title: m[5].trim(),
      line: i,
    });
  }
  return items;
}

/** Parses the dedicated Claude activity log note's `## YYYY-MM-DD` / `- bullet` structure into
 * one entry per date, bullets in file order. The file is written newest-date-section-first, so
 * callers get entries newest-first for free just by returning them in the order found — no
 * sorting needed. A heading that isn't `YYYY-MM-DD` (nothing should write one, but a human could)
 * is skipped rather than guessed at. */
export function extractActivityLogEntries(body: string): { date: string; lines: string[] }[] {
  const entries: { date: string; lines: string[] }[] = [];
  let current: { date: string; lines: string[] } | null = null;
  for (const rawLine of body.split('\n')) {
    const heading = rawLine.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (heading) {
      current = { date: heading[1], lines: [] };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const bullet = rawLine.match(/^-\s+(.*)$/);
    if (bullet) current.lines.push(bullet[1].trim());
  }
  return entries;
}

/** Every attachment target a note's raw body references — image embeds and plain Markdown images (not already-resolved `/api/...` or external `https://` links). Used to find attachments nothing links to anymore. */
export function extractAttachmentRefs(body: string): string[] {
  const refs: string[] = [];
  for (const m of body.matchAll(EMBED_RE)) {
    const { target } = splitTarget(m[1]);
    if (IMAGE_EXT.test(target)) refs.push(target);
  }
  for (const m of body.matchAll(MD_IMAGE_RE)) refs.push(decodeURIComponent(m[2]));
  return refs;
}

export function toNoteLinks(
  rawLinks: { raw: string; target: string; alias: string }[],
  resolveNote: (name: string) => string | null,
): NoteLink[] {
  return rawLinks.map((l) => ({ raw: l.raw, alias: l.alias, resolvedPath: resolveNote(l.target) }));
}

/** Replaces plain `[[wikilinks]]` (not embeds) in arbitrary text, e.g. a frontmatter value. */
export function linkifyText(text: string, resolveNote: (name: string) => string | null): string {
  return text.replace(WIKILINK_RE, (_m, rawTarget: string, aliasPart?: string) => {
    const target = rawTarget.trim();
    const alias = (aliasPart ?? target).trim();
    const notePath = resolveNote(target);
    return notePath
      ? `[${alias}](obsidian://note/${encodeURIComponent(notePath)})`
      : `[${alias}](obsidian://unresolved/${encodeURIComponent(target)})`;
  });
}
