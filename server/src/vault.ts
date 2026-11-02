import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import chokidar, { type FSWatcher } from 'chokidar';
import MiniSearch from 'minisearch';
import {
  extractActivityLogEntries,
  extractAttachmentRefs,
  extractChecklistItems,
  extractInlineTags,
  extractSportsEvents,
  extractWikiLinks,
  linkifyText,
  makeExcerpt,
  toNoteLinks,
  transformBody,
} from './markdown.js';
import { maybeSnapshot } from './versions.js';
import type {
  ActivityLogEntry,
  BookmarkItem,
  ChecklistItem,
  CreateNoteInput,
  CreateOptions,
  ImportResult,
  Note,
  NoteDetail,
  NoteSummary,
  SportsEvent,
} from './types.js';

const RESOURCES_ROOT = '4. Resources';
const PROJECTS_ROOT = '2. Projects';
const AREAS_ROOT = '3. Areas';
const INBOX_ROOT = '1. Inbox';
const ARCHIVE_ROOT = '5. Archive';
const TRASH_ROOT = '.trash';
const TASKS_FILE = '_Templates/tasks-general.md';
const BOOKMARKS_FILE = '_Templates/bookmarks-general.md';
const DAILY_ROOT = '6. Daily';
const SPORTS_EVENTS_FILE = '_Templates/sports-events.md';
const DAILY_TEMPLATE_FILE = '_Templates/daily-note.md';
const TRENDING_FEED_FILE = '_Templates/trending-feed.md';
const ACTIVITY_LOG_FILE = '_Templates/claude-activity-log.md';

/** Notes that get written to by background automation rather than by actually editing the
 * vault yourself — excluded from `getStats()`'s "last edited" so that stat reflects your own
 * activity, not whichever auto-written log the Trending poller (every few minutes, totally
 * independent of anything you do) or an activity-log entry happened to touch most recently.
 * Daily notes (`DAILY_ROOT`) are excluded too, separately — not because they're automated (you
 * do write them yourself), but because they're a running scratchpad that gets touched so often
 * it would otherwise dominate "last edited" over the note you actually meant to work on. */
const STATS_EXCLUDED_FILES = new Set([TRENDING_FEED_FILE, ACTIVITY_LOG_FILE]);

const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git', '.claude', 'node_modules']);
const ATTACHMENT_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|pdf|mp3|wav|mp4|mov)$/i;

function toFrontmatterTags(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase());
  if (typeof value === 'string') return value.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  return [];
}

function extractFrontmatterLinks(frontmatter: Record<string, unknown>): { raw: string; target: string; alias: string }[] {
  const links: { raw: string; target: string; alias: string }[] = [];
  for (const value of Object.values(frontmatter)) {
    if (typeof value === 'string') links.push(...extractWikiLinks(value));
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string') links.push(...extractWikiLinks(item));
    }
  }
  return links;
}

function sanitizeSegment(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '').replace(/^\.+|\.+$/g, '').trim();
}

class ConflictError extends Error {}
class ValidationError extends Error {}

/** A sports event's "still relevant until" timestamp. A multi-day event (`endDate` set) runs
 * through its end date/time, same date-only-counts-through-end-of-day rule as a single-day event
 * applied to whichever end actually has a time. A single-day event with no `time` counts as
 * upcoming through the end of its calendar day, not just until midnight at its start — someone
 * adding "today, no time" shouldn't see it vanish from the card the instant the clock ticks past
 * 00:00. */
function sportsEventEnd(e: SportsEvent): number {
  if (e.endDate) {
    const end = new Date(`${e.endDate}T${e.endTime ?? '00:00'}:00`).getTime();
    return e.endTime ? end : end + 24 * 60 * 60 * 1000 - 1;
  }
  const start = new Date(`${e.date}T${e.time ?? '00:00'}:00`).getTime();
  return e.time ? start : start + 24 * 60 * 60 * 1000 - 1;
}

/** The read-mode page always renders the note's own title as its own styled `<h1>` above the
 * body (see NoteView.tsx) — so a body that *also* opens with an H1 (the "+ New note" template
 * writes one, and some hand-authored notes do too) shows the same title twice, stacked. Strips
 * just that one leading heading from what gets rendered; `note.body` itself (word count, search
 * index, excerpt, task line numbers) is untouched — this only affects renderedBody's HTML. Same
 * regex as the web side's `splitHeaderBody`, which does the equivalent strip before loading a
 * note into the editor. */
function stripLeadingHeading(body: string): string {
  return body.replace(/^(?:[ \t]*\n)*# [^\n]*\n?/, '');
}

function toSummary(note: Note): NoteSummary {
  return {
    relPath: note.relPath,
    title: note.title,
    folder: note.folder,
    tags: note.tags,
    mtime: note.mtime,
    excerpt: note.excerpt,
    wordCount: note.wordCount,
  };
}

/** Shared by `findDuplicates` (vault-wide pairs) and `getRelatedNotes` (one note's neighbors) —
 * MiniSearch's own BM25-ish scores aren't comparable across differently-sized queries, so both
 * methods use MiniSearch only to cheaply shortlist candidates, then rank with this instead. */
function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function jaccard(x: Set<string>, y: Set<string>): number {
  if (x.size === 0 || y.size === 0) return 0;
  let intersection = 0;
  for (const t of x) if (y.has(t)) intersection++;
  return intersection / (x.size + y.size - intersection);
}

export class VaultIndex {
  private notes = new Map<string, Note>();
  private attachments = new Map<string, string>(); // lowercased basename -> relPath
  private referencedAttachments = new Set<string>(); // relPaths at least one note still links to
  private basenames = new Map<string, string[]>(); // lowercased basename (no ext) -> relPath[]
  private backlinks = new Map<string, Set<string>>();
  private tasks: ChecklistItem[] = [];
  private bookmarks: BookmarkItem[] = [];
  private sportsEvents: SportsEvent[] = [];
  private activityLogEntries: ActivityLogEntry[] = [];
  private search = new MiniSearch<{ id: string; title: string; body: string; tags: string; folder: string }>({
    idField: 'id',
    fields: ['title', 'body', 'tags', 'folder'],
    storeFields: ['title'],
    searchOptions: { boost: { title: 4, tags: 2 }, fuzzy: 0.2, prefix: true },
  });
  private watcher: FSWatcher | null = null;
  private rebuildTimer: NodeJS.Timeout | null = null;
  private onChange: (() => void) | null = null;
  // Per-note write queues, keyed by relPath — same reasoning as versions.ts's own queue.
  // `appendToTrendingFeed` does a read-modify-write (append a line to whatever's there right
  // now), so two calls landing close together (e.g. two Trending sources refreshing within the
  // same second) could otherwise both read the pre-append content and one write would clobber
  // the other's addition.
  private writeQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly root: string) {}

  private enqueueWrite<T>(relPath: string, fn: () => Promise<T>): Promise<T> {
    const prev = (this.writeQueues.get(relPath) ?? Promise.resolve()) as Promise<unknown>;
    const next = prev.catch(() => undefined).then(fn);
    this.writeQueues.set(relPath, next);
    return next;
  }

  async init(onChange?: () => void): Promise<void> {
    this.onChange = onChange ?? null;
    await this.rebuild();
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      ignored: (p: string) => {
        const base = path.basename(p);
        return IGNORED_DIRS.has(base);
      },
    });
    this.watcher.on('all', () => this.scheduleRebuild());
  }

  async close(): Promise<void> {
    await this.watcher?.close();
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuild().then(() => this.onChange?.());
    }, 400);
  }

  /** Every real folder under the vault root (ignored dirs excluded), regardless of whether it
   * holds any notes — unlike the sidebar/Explorer trees built from `note.folder`, which only ever
   * show a folder once something lands inside it. Explorer's "New Folder" needs this so a
   * just-created empty folder actually shows up instead of silently existing on disk with nothing
   * pointing at it in the UI. */
  private async walkDirs(dir: string, acc: string[] = []): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      acc.push(path.relative(this.root, full).split(path.sep).join('/'));
      await this.walkDirs(full, acc);
    }
    return acc;
  }

  async listFolders(): Promise<string[]> {
    return this.walkDirs(this.root);
  }

  /** Explorer's "New Folder" — `folderPath` is a full vault-relative path (parent + name already
   * joined), sanitized segment-by-segment the same way `createNote`'s folder input is, then
   * re-validated against path traversal the same way every other write path on this class is.
   * `recursive: true` makes this idempotent for an already-existing folder rather than erroring,
   * same spirit as `moveNote`'s own `mkdir`. */
  async createFolder(folderPath: string): Promise<string> {
    const clean = folderPath
      .split('/')
      .map((seg) => sanitizeSegment(seg))
      .filter(Boolean)
      .join('/');
    if (!clean) throw new ValidationError('Folder name is required.');

    const resolvedRoot = path.resolve(this.root);
    const resolved = path.resolve(this.root, clean);
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
      throw new ValidationError('Invalid folder path.');
    }

    await fs.mkdir(resolved, { recursive: true });
    return clean;
  }

  private async walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.walk(full)));
      } else {
        files.push(full);
      }
    }
    return files;
  }

  private async rebuild(): Promise<void> {
    const allFiles = await this.walk(this.root).catch(() => [] as string[]);
    const notes = new Map<string, Note>();
    const attachments = new Map<string, string>();
    const basenames = new Map<string, string[]>();

    for (const abs of allFiles) {
      const relPath = path.relative(this.root, abs).split(path.sep).join('/');
      if (abs.endsWith('.md')) {
        try {
          const raw = await fs.readFile(abs, 'utf8');
          const stat = await fs.stat(abs);
          const parsed = matter(raw);
          const base = path.basename(relPath, '.md');
          const folder = path.dirname(relPath) === '.' ? '' : path.dirname(relPath);
          const frontmatterTags = toFrontmatterTags((parsed.data as Record<string, unknown>).tags);
          const tags = [...new Set([...frontmatterTags, ...extractInlineTags(parsed.content)])];
          // gray-matter's `content` is always the raw file's trailing substring after frontmatter —
          // the `endsWith` guard just keeps this safe (bodyStartLine 0) if that assumption ever breaks.
          const bodyStartLine = raw.endsWith(parsed.content)
            ? raw.slice(0, raw.length - parsed.content.length).split('\n').length - 1
            : 0;
          const note: Note = {
            relPath,
            title: String((parsed.data as Record<string, unknown>).title ?? base),
            folder,
            tags,
            frontmatter: parsed.data as Record<string, unknown>,
            body: parsed.content,
            excerpt: makeExcerpt(parsed.content),
            mtime: stat.mtimeMs,
            wordCount: parsed.content.split(/\s+/).filter(Boolean).length,
            links: [],
            bodyStartLine,
          };
          notes.set(relPath, note);
          const key = base.toLowerCase();
          basenames.set(key, [...(basenames.get(key) ?? []), relPath]);
        } catch {
          // unreadable file, skip
        }
      } else if (ATTACHMENT_EXT.test(abs)) {
        attachments.set(path.basename(abs).toLowerCase(), relPath);
      }
    }

    const resolveNote = (name: string): string | null => {
      const cleaned = name.replace(/\.md$/i, '').trim();
      const direct = notes.get(cleaned + '.md') ?? notes.get(cleaned);
      if (direct) return direct.relPath;
      const candidates = basenames.get(cleaned.toLowerCase());
      return candidates?.[0] ?? null;
    };
    const resolveAttachment = (name: string): string | null => {
      const base = path.basename(name).toLowerCase();
      return attachments.get(base) ?? null;
    };

    const backlinks = new Map<string, Set<string>>();
    const referencedAttachments = new Set<string>();
    for (const note of notes.values()) {
      const rawLinks = [...extractWikiLinks(note.body), ...extractFrontmatterLinks(note.frontmatter)];
      note.links = toNoteLinks(rawLinks, resolveNote);
      for (const link of note.links) {
        if (link.resolvedPath && link.resolvedPath !== note.relPath) {
          if (!backlinks.has(link.resolvedPath)) backlinks.set(link.resolvedPath, new Set());
          backlinks.get(link.resolvedPath)!.add(note.relPath);
        }
      }
      for (const ref of extractAttachmentRefs(note.body)) {
        const resolved = resolveAttachment(ref);
        if (resolved) referencedAttachments.add(resolved);
      }
    }

    const tasks: ChecklistItem[] = [];
    const bookmarks: BookmarkItem[] = [];
    for (const note of notes.values()) {
      for (const item of extractChecklistItems(note.body)) {
        const base = {
          done: item.done,
          text: item.text,
          group: item.group,
          sourcePath: note.relPath,
          sourceTitle: note.title,
          line: note.bodyStartLine + item.line,
          mtime: note.mtime,
        };
        if (item.url) bookmarks.push({ ...base, url: item.url });
        else tasks.push(base);
      }
    }
    this.tasks = tasks;
    this.bookmarks = bookmarks;

    const sportsNote = notes.get(SPORTS_EVENTS_FILE);
    this.sportsEvents = sportsNote ? extractSportsEvents(sportsNote.body) : [];

    const activityLogNote = notes.get(ACTIVITY_LOG_FILE);
    this.activityLogEntries = activityLogNote ? extractActivityLogEntries(activityLogNote.body) : [];

    this.notes = notes;
    this.attachments = attachments;
    this.basenames = basenames;
    this.backlinks = backlinks;
    this.referencedAttachments = referencedAttachments;

    this.search.removeAll();
    this.search.addAll(
      [...notes.values()].map((n) => ({
        id: n.relPath,
        title: n.title,
        body: n.body,
        tags: n.tags.join(' '),
        folder: n.folder,
      })),
    );
  }

  getStats() {
    const tagCounts = new Map<string, number>();
    let lastModified: NoteSummary | null = null;
    const folders = new Set<string>();
    for (const note of this.notes.values()) {
      for (const tag of note.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      if (note.folder) folders.add(note.folder.split('/')[0]);
      const excluded = STATS_EXCLUDED_FILES.has(note.relPath) || note.folder === DAILY_ROOT;
      if (!excluded && (!lastModified || note.mtime > lastModified.mtime)) {
        lastModified = toSummary(note);
      }
    }
    return {
      noteCount: this.notes.size,
      tagCount: tagCounts.size,
      folderCount: folders.size,
      lastModified,
    };
  }

  listNotes(): NoteSummary[] {
    return [...this.notes.values()].sort((a, b) => b.mtime - a.mtime).map(toSummary);
  }

  listTags(): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const note of this.notes.values()) {
      for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }

  getNote(relPath: string): NoteDetail | null {
    const note = this.notes.get(relPath);
    if (!note) return null;
    const resolveNote = (name: string): string | null => {
      const cleaned = name.replace(/\.md$/i, '').trim();
      const direct = this.notes.get(cleaned + '.md') ?? this.notes.get(cleaned);
      if (direct) return direct.relPath;
      const candidates = this.basenames.get(cleaned.toLowerCase());
      return candidates?.[0] ?? null;
    };
    const resolveAttachment = (name: string): string | null => {
      const base = path.basename(name).toLowerCase();
      return this.attachments.get(base) ?? null;
    };
    const backlinkPaths = this.backlinks.get(relPath) ?? new Set<string>();
    const linkifyValue = (value: unknown): unknown => {
      if (typeof value === 'string') return linkifyText(value, resolveNote);
      if (Array.isArray(value)) return value.map(linkifyValue);
      return value;
    };
    return {
      ...toSummary(note),
      frontmatter: Object.fromEntries(
        Object.entries(note.frontmatter)
          .filter(([k]) => k !== 'tags')
          .map(([k, v]) => [k, linkifyValue(v)]),
      ),
      renderedBody: transformBody(stripLeadingHeading(note.body), resolveNote, resolveAttachment),
      backlinks: [...backlinkPaths]
        .map((p) => this.notes.get(p))
        .filter((n): n is Note => Boolean(n))
        .map(toSummary),
      outgoingLinks: note.links.map((l) => ({ alias: l.alias, resolvedPath: l.resolvedPath, raw: l.raw })),
    };
  }

  resolveAttachmentPath(relPath: string): string | null {
    const abs = path.resolve(this.root, relPath);
    if (!abs.startsWith(path.resolve(this.root))) return null;
    return abs;
  }

  searchNotes(query: string, limit = 30): (NoteSummary & { score: number })[] {
    if (!query.trim()) return [];
    const results = this.search.search(query, { combineWith: 'AND' });
    const fallback = results.length ? results : this.search.search(query, { combineWith: 'OR' });
    return fallback.slice(0, limit).map((r) => {
      const note = this.notes.get(String(r.id))!;
      return { ...toSummary(note), score: r.score };
    });
  }

  listTasks(): ChecklistItem[] {
    return [...this.tasks].sort((a, b) => Number(a.done) - Number(b.done));
  }

  listBookmarks(): BookmarkItem[] {
    return [...this.bookmarks].sort((a, b) => Number(a.done) - Number(b.done));
  }

  /** Events still ahead of "now", soonest first. A date-only event (no `time`) counts as upcoming
   * through the end of its calendar day, not just until midnight at its start — someone adding
   * "today, no time" shouldn't see it vanish from the card the instant the server's clock ticks
   * past 00:00. */
  /** Every parsed event, past and future, sorted chronologically — for the Calendar view, which
   * needs a date-bounded window (not just "the next N") and renders past-week cells too. */
  listAllSportsEvents(): SportsEvent[] {
    return [...this.sportsEvents].sort((a, b) => {
      const at = new Date(`${a.date}T${a.time ?? '00:00'}:00`).getTime();
      const bt = new Date(`${b.date}T${b.time ?? '00:00'}:00`).getTime();
      return at - bt;
    });
  }

  listUpcomingSportsEvents(limit = 5): SportsEvent[] {
    const now = Date.now();
    return [...this.sportsEvents]
      .map((e) => ({ event: e, end: sportsEventEnd(e) }))
      .filter((x) => Number.isFinite(x.end) && x.end >= now)
      .sort((a, b) => a.end - b.end)
      .slice(0, limit)
      .map((x) => x.event);
  }

  /** Already newest-date-first — see `extractActivityLogEntries`. */
  listActivityLog(): ActivityLogEntry[] {
    return this.activityLogEntries;
  }

  getCreateOptions(): CreateOptions {
    const projects = new Set<string>();
    const areas = new Set<string>();
    const resourceFolders = new Set<string>();
    for (const note of this.notes.values()) {
      if (note.folder === PROJECTS_ROOT) projects.add(note.title);
      else if (note.folder === AREAS_ROOT) areas.add(note.title);
      else if (note.folder.startsWith(RESOURCES_ROOT + '/')) {
        resourceFolders.add(note.folder.slice(RESOURCES_ROOT.length + 1).split('/')[0]);
      }
    }
    return {
      projects: [...projects].sort(),
      areas: [...areas].sort(),
      resourceFolders: [...resourceFolders].sort(),
    };
  }

  async createNote(input: CreateNoteInput): Promise<NoteDetail> {
    const title = sanitizeSegment(input.title);
    if (!title) throw new ValidationError('Title is required.');
    if (!input.folder) throw new ValidationError('Folder is required.');

    const isInbox = input.folder === INBOX_ROOT;
    const folder = isInbox ? INBOX_ROOT : sanitizeSegment(input.folder);
    if (!isInbox && !folder) throw new ValidationError('Folder is required.');

    const targetDir = isInbox ? path.resolve(this.root, INBOX_ROOT) : path.resolve(this.root, RESOURCES_ROOT, folder);
    const targetFile = path.join(targetDir, `${title}.md`);
    if (!targetFile.startsWith(path.resolve(this.root))) {
      throw new ValidationError('Invalid title or folder.');
    }

    const esc = (s: string) => s.replace(/"/g, "'");
    const lines = [
      '---',
      'type: resource',
      'tags: [resource]',
      'source:',
      input.project ? `project: "[[${esc(input.project)}]]"` : 'project:',
      input.area ? `area:\n  - "[[${esc(input.area)}]]"` : 'area:',
      `created: ${new Date().toISOString().slice(0, 10)}`,
      'notetoolbar: Main',
      '---',
      '',
      `# ${title}`,
      '',
    ];

    await fs.mkdir(targetDir, { recursive: true });
    try {
      await fs.writeFile(targetFile, lines.join('\n'), { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ConflictError(`"${title}" already exists in ${folder}.`);
      }
      throw err;
    }

    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
    const relPath = path.relative(this.root, targetFile).split(path.sep).join('/');
    return this.getNote(relPath)!;
  }

  /** Moves an existing note into `destRoot` (flat, no subfolders), renaming on collision. */
  private async moveNote(relPath: string, destRoot: string): Promise<string> {
    const note = this.notes.get(relPath);
    if (!note) throw new ValidationError('Note not found.');

    const destDir = path.resolve(this.root, destRoot);
    await fs.mkdir(destDir, { recursive: true });

    const base = path.basename(relPath, '.md');
    let destFile = path.join(destDir, `${base}.md`);
    for (let n = 2; ; n++) {
      try {
        await fs.access(destFile);
        destFile = path.join(destDir, `${base} (${n}).md`);
      } catch {
        break;
      }
    }

    await fs.rename(path.resolve(this.root, relPath), destFile);
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
    return path.relative(this.root, destFile).split(path.sep).join('/');
  }

  async archiveNote(relPath: string): Promise<void> {
    const note = this.notes.get(relPath);
    if (!note) throw new ValidationError('Note not found.');
    if (note.folder === ARCHIVE_ROOT) throw new ValidationError('Already in Archive.');
    await this.moveNote(relPath, ARCHIVE_ROOT);
  }

  async deleteNote(relPath: string): Promise<void> {
    await this.moveNote(relPath, TRASH_ROOT);
  }

  /**
   * Flips a single `- [ ]`/`- [x]` checkbox line to `done`, in place, leaving the rest of the file
   * untouched — the one case where this app edits an existing note rather than only creating new
   * ones. `line` is the raw-file line number from a `ChecklistItem` returned by `listTasks`/
   * `listBookmarks`; if the note changed since that was read and the line no longer looks like a
   * checklist item, this throws rather than guessing and corrupting an unrelated line.
   */
  async toggleTask(relPath: string, line: number, done: boolean): Promise<void> {
    const abs = path.resolve(this.root, relPath);
    if (!abs.startsWith(path.resolve(this.root))) throw new ValidationError('Invalid path.');

    let raw: string;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      throw new ValidationError('That note no longer exists.');
    }
    const lines = raw.split('\n');
    if (line < 0 || line >= lines.length) {
      throw new ValidationError('That task no longer exists — the note may have changed.');
    }
    const m = lines[line].match(/^(\s*[-*]\s*\[)([ xX])(\]\s*.*)$/);
    if (!m) {
      throw new ValidationError('That line is no longer a checklist item — the note may have changed.');
    }
    lines[line] = `${m[1]}${done ? 'x' : ' '}${m[3]}`;
    await fs.writeFile(abs, lines.join('\n'));

    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
  }

  /**
   * Appends a new `- [ ] #task ...` line to `TASKS_FILE`, under a `## YYYY-MM-DD` heading for
   * today — creating that heading (and the file itself) if neither exists yet. Mirrors the vault's
   * own convention already in that file (dated headings, `#task`-tagged lines).
   */
  /** Returns the full raw file content (frontmatter + body, untouched) for in-place editing or export. */
  async getRawContent(relPath: string): Promise<string> {
    const abs = path.resolve(this.root, relPath);
    if (!abs.startsWith(path.resolve(this.root)) || !this.notes.has(relPath)) {
      throw new ValidationError('Note not found.');
    }
    try {
      return await fs.readFile(abs, 'utf8');
    } catch {
      throw new ValidationError('That note no longer exists.');
    }
  }

  /** Overwrites an existing note's full raw content — the general-purpose counterpart to `toggleTask`. */
  async updateNoteContent(relPath: string, content: string): Promise<NoteDetail> {
    const abs = path.resolve(this.root, relPath);
    if (!abs.startsWith(path.resolve(this.root)) || !this.notes.has(relPath)) {
      throw new ValidationError('Note not found.');
    }
    const previous = await fs.readFile(abs, 'utf8').catch(() => null);
    if (previous !== null) await maybeSnapshot(relPath, previous);
    await fs.writeFile(abs, content);
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
    const updated = this.getNote(relPath);
    if (!updated) throw new ValidationError('Note no longer exists after save.');
    return updated;
  }

  /**
   * Returns today's daily note (`6. Daily/YYYY-MM-DD.md`), creating it on first visit each day
   * from `DAILY_TEMPLATE_PATH` if that template exists, or a minimal frontmatter + heading
   * otherwise. `date` is the client's local date (not the server's), since "today" should
   * follow the user's clock, not the container's.
   */
  async getOrCreateDaily(date: string): Promise<NoteDetail> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('Invalid date.');
    const relPath = `${DAILY_ROOT}/${date}.md`;
    if (this.notes.has(relPath)) return this.getNote(relPath)!;

    const targetDir = path.resolve(this.root, DAILY_ROOT);
    const targetFile = path.join(targetDir, `${date}.md`);
    const content = await this.buildDailyContent(date);

    await fs.mkdir(targetDir, { recursive: true });
    try {
      await fs.writeFile(targetFile, content, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // created by a concurrent request between the has() check and here — fine, rebuild picks it up
    }

    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
    const note = this.getNote(relPath);
    if (!note) throw new ValidationError('Daily note could not be created.');
    return note;
  }

  /**
   * Reads `_Templates/daily-note.md` (create it yourself in the vault — there's no settings UI
   * for this, it's just a plain note) and substitutes every `{{date}}` with today's date.
   * Falls back to the original minimal frontmatter + heading when no template file exists.
   */
  private async buildDailyContent(date: string): Promise<string> {
    const templateFile = path.resolve(this.root, DAILY_TEMPLATE_FILE);
    try {
      const template = await fs.readFile(templateFile, 'utf8');
      return template.replace(/\{\{date\}\}/g, date);
    } catch {
      return ['---', 'type: daily', 'tags: [daily]', `created: ${date}`, '---', '', `# ${date}`, ''].join('\n');
    }
  }

  /** Returns an existing note, or creates it from `defaultContent` first (idempotent against a
   * concurrent creator the same way `getOrCreateDaily` is). Used for the handful of dedicated,
   * ever-growing "app log" notes (Trending feed) that — unlike the daily note — aren't tied to
   * any particular date. */
  private async getOrCreateNote(relPath: string, defaultContent: string): Promise<NoteDetail> {
    if (this.notes.has(relPath)) return this.getNote(relPath)!;
    const abs = path.resolve(this.root, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    try {
      await fs.writeFile(abs, defaultContent, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
    const note = this.getNote(relPath);
    if (!note) throw new ValidationError('Note could not be created.');
    return note;
  }

  /**
   * Appends new Trending-card lines to the dedicated `_Templates/trending-feed.md` note, nested
   * `## <date>` -> `### <source>` (creating both on first use that day/source) — used by the
   * Trending card's backend poller (`trending.ts`) to keep a persistent record of every link it's
   * shown, in case you miss one while it's rotating; see `recordAndNotify` there for how "new" is
   * decided. Previously this wrote into that day's *daily* note instead (see `vault_activity_log`
   * memory for why it moved: it was crowding out Today's Note). A brand new date section is
   * inserted right after the title, keeping the note newest-day-first — otherwise it'd grow
   * downward forever before anything new became visible without scrolling.
   */
  async appendToTrendingFeed(date: string, source: string, newLines: string[]): Promise<void> {
    if (newLines.length === 0) return;
    const defaultContent = ['---', 'type: trending-feed', '---', '', '# Trending feed', ''].join('\n');
    const note = await this.getOrCreateNote(TRENDING_FEED_FILE, defaultContent);
    return this.enqueueWrite(note.relPath, async () => {
      const raw = await this.getRawContent(note.relPath);
      const lines = raw.split('\n');
      const dateHeadingLine = `## ${date}`;
      const subHeadingLine = `### ${source}`;
      const bullets = newLines.map((l) => `- ${l}`);

      const dateIdx = lines.indexOf(dateHeadingLine);
      if (dateIdx === -1) {
        const titleIdx = lines.findIndex((l) => l.startsWith('# '));
        const insertAt = titleIdx === -1 ? 0 : titleIdx + 1;
        lines.splice(insertAt, 0, '', dateHeadingLine, subHeadingLine, ...bullets);
        await this.updateNoteContent(note.relPath, lines.join('\n'));
        return;
      }

      let sectionEnd = lines.length;
      for (let i = dateIdx + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) {
          sectionEnd = i;
          break;
        }
      }

      let subIdx = -1;
      for (let i = dateIdx + 1; i < sectionEnd; i++) {
        if (lines[i] === subHeadingLine) {
          subIdx = i;
          break;
        }
      }

      if (subIdx !== -1) {
        let insertAt = sectionEnd;
        for (let i = subIdx + 1; i < sectionEnd; i++) {
          if (lines[i].startsWith('### ') || lines[i].startsWith('## ')) {
            insertAt = i;
            break;
          }
        }
        lines.splice(insertAt, 0, ...bullets);
      } else {
        let insertAt = sectionEnd;
        while (insertAt > dateIdx + 1 && lines[insertAt - 1] === '') insertAt--;
        lines.splice(insertAt, 0, subHeadingLine, ...bullets);
      }

      await this.updateNoteContent(note.relPath, lines.join('\n'));
    });
  }

  /**
   * Nodes + edges for a vault-wide link graph. Edges are deduped as undirected pairs (an A→B
   * wikilink and a B→A one render as a single line) since the graph is for visually spotting
   * clusters/isolation, not for showing link direction.
   */
  getGraph(): {
    nodes: { id: string; title: string; folder: string; tags: string[] }[];
    edges: { source: string; target: string }[];
  } {
    const nodes = [...this.notes.values()].map((n) => ({ id: n.relPath, title: n.title, folder: n.folder, tags: n.tags }));
    const seen = new Set<string>();
    const edges: { source: string; target: string }[] = [];
    for (const note of this.notes.values()) {
      for (const link of note.links) {
        if (!link.resolvedPath || link.resolvedPath === note.relPath) continue;
        const key = [note.relPath, link.resolvedPath].sort().join('\u0000');
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source: note.relPath, target: link.resolvedPath });
      }
    }
    return { nodes, edges };
  }

  /** Notes with no incoming backlinks and no resolved outgoing links — disconnected from the rest of the vault. */
  listOrphans(): NoteSummary[] {
    return [...this.notes.values()]
      .filter((note) => {
        const hasBacklinks = (this.backlinks.get(note.relPath)?.size ?? 0) > 0;
        const hasOutgoing = note.links.some((l) => l.resolvedPath);
        return !hasBacklinks && !hasOutgoing;
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map(toSummary);
  }

  /**
   * Candidate pairs of highly-similar notes, for spotting accidental duplicates/near-duplicates.
   * Two-stage: MiniSearch's existing index narrows each note down to its 5 closest matches (cheap,
   * reuses the index already built for search), then an actual Jaccard similarity over word sets
   * scores each candidate — MiniSearch's own BM25-ish scores aren't comparable across queries of
   * different lengths, so they're only good enough here to shortlist candidates, not to rank them.
   */
  findDuplicates(): { a: NoteSummary; b: NoteSummary; similarity: number }[] {
    const candidates = [...this.notes.values()].filter((n) => n.wordCount >= 20);
    const seen = new Set<string>();
    const results: { a: NoteSummary; b: NoteSummary; similarity: number }[] = [];

    for (const note of candidates) {
      const query = `${note.title} ${note.body}`.slice(0, 1000);
      const matches = this.search
        .search(query, { combineWith: 'OR' })
        .filter((r) => r.id !== note.relPath)
        .slice(0, 5);
      const tokensA = tokenize(note.body);
      for (const match of matches) {
        const other = this.notes.get(String(match.id));
        if (!other) continue;
        const key = [note.relPath, other.relPath].sort().join('\u0000');
        if (seen.has(key)) continue;
        const similarity = jaccard(tokensA, tokenize(other.body));
        if (similarity < 0.3) continue;
        seen.add(key);
        results.push({ a: toSummary(note), b: toSummary(other), similarity });
      }
    }
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, 30);
  }

  /**
   * "Related to this note" — same two-stage MiniSearch-shortlist-then-Jaccard-rank approach as
   * `findDuplicates`, just scoped to one note's neighbors instead of every pair in the vault, and
   * without the duplicate-detector's high 0.3 similarity floor (that threshold means "probably a
   * near-duplicate"; a related-notes list is useful at much looser similarity than that). Notes
   * already linked via an existing backlink or outgoing link are excluded — this is specifically
   * for surfacing *unlinked* relatedness, the thing backlinks don't already show.
   */
  getRelatedNotes(relPath: string, limit = 5): NoteSummary[] {
    const note = this.notes.get(relPath);
    if (!note) return [];
    const alreadyLinked = new Set<string>([
      relPath,
      ...(this.backlinks.get(relPath) ?? []),
      ...note.links.map((l) => l.resolvedPath).filter((p): p is string => p !== null),
    ]);

    const query = `${note.title} ${note.body}`.slice(0, 1000);
    const matches = this.search.search(query, { combineWith: 'OR' }).filter((r) => !alreadyLinked.has(String(r.id)));
    const tokensA = tokenize(note.body);

    return matches
      .map((m) => {
        const other = this.notes.get(String(m.id));
        return other ? { note: other, similarity: jaccard(tokensA, tokenize(other.body)) } : null;
      })
      .filter((r): r is { note: Note; similarity: number } => r !== null && r.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map((r) => toSummary(r.note));
  }

  /** Attachments in `_Attachments` that no note's embed/image syntax resolves to anymore — the
   * mirror image of `listOrphans`, for attachments instead of notes. */
  async listDeadAttachments(): Promise<{ relPath: string; size: number }[]> {
    const dead = [...this.attachments.values()].filter((p) => !this.referencedAttachments.has(p));
    return Promise.all(
      dead.map(async (relPath) => {
        const size = await fs.stat(path.resolve(this.root, relPath)).then((s) => s.size).catch(() => 0);
        return { relPath, size };
      }),
    ).then((results) => results.sort((a, b) => b.size - a.size));
  }

  /** Every attachment file in the vault (dead or still referenced) — lets the folder tree show
   * `_Attachments` as a browsable node instead of it being invisible just because it holds no
   * `.md` notes. */
  async listAttachments(): Promise<{ relPath: string; size: number }[]> {
    return Promise.all(
      [...this.attachments.values()].map(async (relPath) => {
        const size = await fs.stat(path.resolve(this.root, relPath)).then((s) => s.size).catch(() => 0);
        return { relPath, size };
      }),
    ).then((results) => results.sort((a, b) => a.relPath.localeCompare(b.relPath)));
  }

  /** Total bytes on disk per top-level folder — every file under `this.root` (notes, attachments,
   * everything else), not just what `rebuild()` indexes as a note or a known attachment, so a
   * stray file type doesn't silently vanish from the total. Walks fresh rather than reusing
   * `rebuild()`'s own file list since that's not cached between rebuilds. */
  async getVaultSize(): Promise<{ folder: string; bytes: number }[]> {
    const allFiles = await this.walk(this.root).catch(() => [] as string[]);
    const sized = await Promise.all(
      allFiles.map(async (abs) => ({
        relPath: path.relative(this.root, abs).split(path.sep).join('/'),
        size: await fs.stat(abs).then((s) => s.size).catch(() => 0),
      })),
    );
    const byFolder = new Map<string, number>();
    for (const { relPath, size } of sized) {
      const top = relPath.includes('/') ? relPath.split('/')[0] : '(root)';
      byFolder.set(top, (byFolder.get(top) ?? 0) + size);
    }
    return [...byFolder.entries()].map(([folder, bytes]) => ({ folder, bytes })).sort((a, b) => b.bytes - a.bytes);
  }

  /** Saves an uploaded image into `_Attachments`, name-collision-safe via a timestamp suffix, and
   * returns its relPath so the caller can drop a Markdown image link in right after. */
  async saveAttachment(originalName: string, data: Buffer): Promise<string> {
    const ext = path.extname(originalName) || '.png';
    const base = sanitizeSegment(path.basename(originalName, ext)) || 'image';
    const dir = path.resolve(this.root, '_Attachments');
    await fs.mkdir(dir, { recursive: true });
    const filename = `${base}-${Date.now()}${ext}`;
    await fs.writeFile(path.join(dir, filename), data);
    this.scheduleRebuild();
    return `_Attachments/${filename}`;
  }

  /** Moves an Inbox (or any) note into an existing-or-new subfolder under `4. Resources` — the
   * "quick move" half of Inbox triage. `folder` is sanitized the same way `createNote` sanitizes a
   * brand-new resource folder name, so moving into a folder that doesn't exist yet just creates it. */
  async moveToResourceFolder(relPath: string, folder: string): Promise<void> {
    if (!this.notes.has(relPath)) throw new ValidationError('Note not found.');
    const clean = sanitizeSegment(folder);
    if (!clean) throw new ValidationError('Folder is required.');
    await this.moveNote(relPath, path.join(RESOURCES_ROOT, clean));
  }

  /** The Explorer view's drag-to-move: `destFolder` is any vault-relative folder path (arbitrary
   * depth, e.g. `"4. Resources/Gaming/PoE2"`), not just a Resources subfolder — it comes from the
   * folder tree the Explorer already built out of real note paths, but is still re-validated here
   * against path traversal the same way every other `relPath`-taking method on this class is. */
  async moveNoteToFolder(relPath: string, destFolder: string): Promise<string> {
    const note = this.notes.get(relPath);
    if (!note) throw new ValidationError('Note not found.');
    const resolvedRoot = path.resolve(this.root);
    const resolvedDest = path.resolve(this.root, destFolder);
    if (resolvedDest !== resolvedRoot && !resolvedDest.startsWith(resolvedRoot + path.sep)) {
      throw new ValidationError('Invalid destination folder.');
    }
    if (note.folder === destFolder) throw new ValidationError('Already in that folder.');
    return this.moveNote(relPath, destFolder);
  }

  /** The Explorer view's drag-from-your-laptop import: writes each dropped `.md` file's raw text
   * into `1. Inbox`, same as any other new note landing there for triage. A name collision (same
   * filename already in Inbox, including two dropped files sharing a name within one drop) gets
   * `" DUPE"` appended rather than silently overwriting or the `moveNote`-style `" (2)"` suffix —
   * the point is to make an accidental re-import of something you already have stand out so you
   * notice and clean it up, not to look like a normal numbered copy. */
  async importNotes(files: { name: string; content: string }[]): Promise<ImportResult[]> {
    const dir = path.resolve(this.root, INBOX_ROOT);
    await fs.mkdir(dir, { recursive: true });

    const exists = async (file: string) => {
      try {
        await fs.access(file);
        return true;
      } catch {
        return false;
      }
    };

    const results: ImportResult[] = [];
    for (const file of files) {
      if (!/\.md$/i.test(file.name)) {
        results.push({ name: file.name, status: 'skipped', reason: 'Not a .md file' });
        continue;
      }
      const base = sanitizeSegment(path.basename(file.name, path.extname(file.name))) || 'Untitled';
      let candidate = `${base}.md`;
      if (await exists(path.join(dir, candidate))) {
        candidate = `${base} DUPE.md`;
        for (let n = 2; await exists(path.join(dir, candidate)); n++) {
          candidate = `${base} DUPE ${n}.md`;
        }
      }
      await fs.writeFile(path.join(dir, candidate), file.content);
      results.push({ name: file.name, status: 'imported', savedAs: candidate });
    }

    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
    return results;
  }

  /**
   * Overwrites a note's frontmatter `tags:` field in place via a surgical line-level text edit
   * (same philosophy as `toggleTask`) rather than re-serializing the whole frontmatter block
   * through gray-matter/js-yaml, which would reformat every other field's quoting/indentation
   * style along with it. Collapses whatever the existing tags were written as (inline `[a, b]` or
   * a multi-line `- item` list) into a single inline-array line.
   *
   * `tags` is the *combined* tag list a client reads off `NoteSummary.tags` (frontmatter + inline
   * `#tag`s in the body, deduped) — so adding a tag here is always correct, but removing one that
   * was actually sourced from an inline `#tag` in the body won't stick: the next rebuild re-derives
   * it from the body text regardless of what frontmatter says. Acceptable for a "quick tag" flow
   * since nearly every tag in this vault already lives in frontmatter, not inline.
   */
  async setTags(relPath: string, tags: string[]): Promise<NoteDetail> {
    const abs = path.resolve(this.root, relPath);
    if (!abs.startsWith(path.resolve(this.root)) || !this.notes.has(relPath)) {
      throw new ValidationError('Note not found.');
    }
    let raw: string;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      throw new ValidationError('That note no longer exists.');
    }

    const lines = raw.split('\n');
    if (lines[0]?.trim() !== '---') {
      throw new ValidationError("This note has no frontmatter to add tags to.");
    }
    const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (closeIdx === -1) {
      throw new ValidationError("This note's frontmatter is malformed.");
    }

    const clean = [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/[,[\]"]/g, '')).filter(Boolean))];
    const newLine = `tags: [${clean.join(', ')}]`;

    let tagLineIdx = -1;
    for (let i = 1; i < closeIdx; i++) {
      if (/^tags:\s*.*$/.test(lines[i])) {
        tagLineIdx = i;
        break;
      }
    }

    if (tagLineIdx === -1) {
      lines.splice(closeIdx, 0, newLine);
    } else {
      const inlineValue = lines[tagLineIdx].replace(/^tags:\s*/, '').trim();
      let spanEnd = tagLineIdx + 1;
      if (!inlineValue) {
        while (spanEnd < closeIdx && /^\s+-\s*/.test(lines[spanEnd])) spanEnd++;
      }
      lines.splice(tagLineIdx, spanEnd - tagLineIdx, newLine);
    }

    await fs.writeFile(abs, lines.join('\n'));
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
    const updated = this.getNote(relPath);
    if (!updated) throw new ValidationError('Note no longer exists after save.');
    return updated;
  }

  async addTask(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) throw new ValidationError('Task text is required.');
    const line = /^#task\b/i.test(trimmed) ? `- [ ] ${trimmed}` : `- [ ] #task ${trimmed}`;

    const abs = path.resolve(this.root, TASKS_FILE);
    let raw = '';
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      raw = '';
    }

    const today = new Date().toISOString().slice(0, 10);
    const heading = `## ${today}`;
    const lines = raw.length ? raw.split('\n') : [];
    const headingIndex = lines.findIndex((l) => l.trim() === heading);

    if (headingIndex === -1) {
      if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
      lines.push(heading, line);
    } else {
      lines.splice(headingIndex + 1, 0, line);
    }

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, lines.join('\n'));

    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
  }

  /**
   * Appends a new `- [ ] <url>` line to `BOOKMARKS_FILE`, under a `## YYYY-MM-DD` heading for
   * today — same file-and-heading convention as `addTask` above. Left as a bare URL (no `#task`
   * tag, no label) on purpose: `extractChecklistItems` in `markdown.ts` only classifies a
   * checkbox as a *bookmark* rather than a task when its text, tags stripped, is nothing but a
   * URL — so this has to stay exactly that to show up in Bookmarks instead of Tasks.
   */
  async addBookmark(url: string): Promise<void> {
    const trimmed = url.trim();
    if (!/^https?:\/\/\S+$/.test(trimmed)) {
      throw new ValidationError('That doesn\'t look like a valid http(s) URL.');
    }
    const line = `- [ ] ${trimmed}`;

    const abs = path.resolve(this.root, BOOKMARKS_FILE);
    let raw = '';
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      raw = '';
    }

    const today = new Date().toISOString().slice(0, 10);
    const heading = `## ${today}`;
    const lines = raw.length ? raw.split('\n') : [];
    const headingIndex = lines.findIndex((l) => l.trim() === heading);

    if (headingIndex === -1) {
      if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
      lines.push(heading, line);
    } else {
      lines.splice(headingIndex + 1, 0, line);
    }

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, lines.join('\n'));

    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
  }

  /**
   * Appends a new `- YYYY-MM-DD[ HH:MM][..YYYY-MM-DD[ HH:MM]] Title [#tag]` line to
   * `SPORTS_EVENTS_FILE`, creating the note (with a short explanatory heading) if it doesn't exist
   * yet. The file is otherwise a plain note a user can open and edit directly in Obsidian or this
   * app — this is just a faster way to add one line without hand-typing the date format.
   * `endDate`/`endTime` are optional, for an event spanning more than one day (a race weekend, a
   * multi-day tournament) — omitted entirely for a plain single-day event, same as before this
   * existed. `sport` is likewise optional — a short tag (e.g. `"f1"`) that drives per-sport
   * coloring client-side; omitted entirely for an untagged event.
   */
  async addSportsEvent(
    title: string,
    date: string,
    time: string | null,
    endDate: string | null = null,
    endTime: string | null = null,
    sport: string | null = null,
  ): Promise<void> {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new ValidationError('Title is required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('Date must be YYYY-MM-DD.');
    if (time && !/^\d{2}:\d{2}$/.test(time)) throw new ValidationError('Time must be HH:MM.');
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new ValidationError('End date must be YYYY-MM-DD.');
    if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) throw new ValidationError('End time must be HH:MM.');
    if (endDate && endDate < date) throw new ValidationError('End date must be on or after the start date.');
    const cleanSport = sport?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || null;

    const line = `- ${date}${time ? ` ${time}` : ''}${endDate ? `..${endDate}${endTime ? ` ${endTime}` : ''}` : ''} ${trimmedTitle}${cleanSport ? ` #${cleanSport}` : ''}`;
    const abs = path.resolve(this.root, SPORTS_EVENTS_FILE);
    let raw = '';
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      raw =
        '# Sports Events\n\nOne per line: `- YYYY-MM-DD[ HH:MM][..YYYY-MM-DD[ HH:MM]] Title [#tag]`. The home page always shows the soonest one ahead of now.\n\n';
    }

    const lines = raw.length ? raw.split('\n') : [];
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(line);

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, lines.join('\n'));

    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    await this.rebuild();
  }
}

export { ConflictError, ValidationError };
