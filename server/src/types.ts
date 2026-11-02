export interface NoteLink {
  raw: string;
  alias: string;
  resolvedPath: string | null;
}

export interface Note {
  relPath: string;
  title: string;
  folder: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  body: string;
  excerpt: string;
  mtime: number;
  wordCount: number;
  links: NoteLink[];
  /** 0-based line where `body` starts in the raw file on disk (i.e. the frontmatter's line count) — lets a checklist item's body-relative line be translated to a raw-file line for `VaultIndex.toggleTask`. */
  bodyStartLine: number;
}

export interface NoteSummary {
  relPath: string;
  title: string;
  folder: string;
  tags: string[];
  mtime: number;
  excerpt: string;
  wordCount: number;
}

export interface NoteDetail extends NoteSummary {
  frontmatter: Record<string, unknown>;
  renderedBody: string;
  backlinks: NoteSummary[];
  outgoingLinks: { alias: string; resolvedPath: string | null; raw: string }[];
}

export interface ChecklistItem {
  done: boolean;
  text: string;
  group: string | null;
  sourcePath: string;
  sourceTitle: string;
  /** This item's 0-based line number in the raw source file — identifies it for `POST /api/tasks/toggle`. */
  line: number;
  /** The source note's mtime, so clients can sort tasks by recency. */
  mtime: number;
}

export interface BookmarkItem extends ChecklistItem {
  url: string;
}

/** One line from the dedicated `_Templates/sports-events.md` note. `date` is `YYYY-MM-DD`; `time`
 * (`HH:MM`, 24h) is null for an all-day/date-only event. `endDate`/`endTime` are set only for a
 * multi-day event (e.g. a race weekend) — null means the event is just the one day. `sport` is a
 * lowercased tag (e.g. `"f1"`, `"cs2"`, `"rugby"`) from an optional trailing `#tag` on the line —
 * null for an untagged event, which just uses the generic sports-card color. `line` identifies the
 * source line for future editing, same convention as `ChecklistItem.line`. */
export interface SportsEvent {
  title: string;
  date: string;
  time: string | null;
  endDate: string | null;
  endTime: string | null;
  sport: string | null;
  line: number;
}

/** One dated group of bullets from `_Templates/claude-activity-log.md` — the dedicated note
 * Claude logs dashboard changes to (see the Activity page), newest date first. */
export interface ActivityLogEntry {
  date: string;
  lines: string[];
}

export interface CreateOptions {
  projects: string[];
  areas: string[];
  resourceFolders: string[];
}

export interface CreateNoteInput {
  title: string;
  folder: string;
  project?: string;
  area?: string;
}

/** One dropped `.md` file's outcome from the Explorer's drag-from-your-laptop import. */
export interface ImportResult {
  name: string;
  status: 'imported' | 'skipped';
  savedAs?: string;
  reason?: string;
}

export interface MailMessage {
  uid: number;
  subject: string;
  from: string;
  /** The sender's actual email address (envelope.from address, not the display name) — used to
   * mark every unread message from this sender as read, not just the one message. Empty string
   * if the envelope didn't carry one (rare, but shouldn't crash anything that reads it). */
  fromAddress: string;
  date: string;
}

/** Written by a host-side cron job (`collect-metrics.sh`, every minute) into the app's existing
 * data volume — the container itself has no access to the host's /proc, /sys, or lm-sensors,
 * and deliberately isn't granted any just to show this. */
export interface HostMetrics {
  collectedAt: string;
  load1: number;
  load5: number;
  load15: number;
  cpuCores: number;
  cpuTempC: number | null;
  memTotalKb: number;
  memUsedKb: number;
  diskRootUsedKb: number;
  diskRootSizeKb: number;
  diskDataUsedKb: number;
  diskDataSizeKb: number;
  hostname: string;
  kernel: string;
  architecture: string;
  osName: string;
  cpuModel: string;
  uptimeSeconds: number;
}

export interface HostMetricsStatus {
  available: boolean;
  metrics: HostMetrics | null;
  error?: string;
}

export interface MailAccountStatus {
  address: string;
  count: number;
  messages: MailMessage[];
  error?: string;
}

/** `configured: false` means no GMAIL_ADDRESS/GMAIL_APP_PASSWORD env vars are set at all — the
 * widget hides itself rather than showing an error for something the user hasn't opted into. */
export interface MailStatus {
  configured: boolean;
  accounts: MailAccountStatus[];
}

/** One rotator slide for the home page's "trending" stat card — a Hacker News headline, a GitHub
 * repo, a Lobsters post, or an item from a user-added RSS/Atom feed all share this shape so the
 * frontend can cycle through them without caring which source produced which slide. */
export interface TrendingItem {
  type: 'news' | 'repo' | 'lobsters' | 'custom';
  /** Human-readable provider name ("Hacker News", "GitHub", "Lobsters", or a custom source's own
   * name) — drives both the card's source badge and the daily note's per-provider `###`
   * subheading, so adding a new provider never requires a new hardcoded label anywhere. */
  source: string;
  title: string;
  url: string;
  /** Short subtitle line, already formatted (e.g. "142 points") — source-specific formatting
   * lives server-side so the frontend stays a dumb renderer. May be empty for a custom feed with
   * no score/points concept. */
  meta: string;
  thumbnail: string | null;
}

/** A user-added RSS/Atom feed polled alongside the built-in Hacker News/GitHub/Lobsters sources
 * — see `trending.ts`'s `addCustomSource`. `id` is server-generated, stable across renames. */
export interface TrendingSource {
  id: string;
  name: string;
  url: string;
}

/** One fiat or crypto pair the home-page exchange-rate card rotates through, each priced in ZAR
 * — a fiat pair's `asOf` is the upstream date (`YYYY-MM-DD`, ECB reference rates only move once
 * per weekday); a crypto pair's is a full ISO timestamp (prices move constantly). */
export interface FxItem {
  id: string;
  /** e.g. "EUR → ZAR", "BTC → ZAR". */
  label: string;
  kind: 'fiat' | 'crypto';
  rate: number | null;
  asOf: string | null;
  available: boolean;
  error: string | null;
}

/** A selectable IMAP mailbox (= a Gmail label, over IMAP) — the "move to" picker's options.
 * `specialUse` (e.g. `\Trash`, `\Sent`, `\All`) is what `deleteMessage` uses to find the real
 * Trash folder regardless of its display name, which Gmail localizes per account language. */
export interface MailFolder {
  path: string;
  name: string;
  specialUse?: string;
}

/** The full, parsed body of one message — fetched on demand when the mail page's preview modal
 * opens, never polled/cached like the unread list is. `html`/`text` mirror whatever the message
 * actually had (a plain-text-only email has `html: null`); the client sanitizes `html` with
 * DOMPurify before rendering it, since this is attacker-controlled content from the open internet. */
export interface MailMessageBody {
  subject: string;
  from: string;
  to: string;
  date: string;
  html: string | null;
  text: string | null;
}

/** One row from the separate IG/downloader dashboard (port 3011), proxied in by `downloads.ts`.
 * `status` mirrors that app's own values verbatim ('downloading' | 'done' | 'failed'). */
export interface DownloadSummary {
  id: string;
  url: string;
  status: string;
  title: string | null;
  author: string | null;
  thumbUrl: string | null;
  mediaUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface QuickLink {
  id: string;
  label: string;
  url: string;
  icon?: string;
}

/** Everything that used to live in the browser's own localStorage — now a single server-side
 * record so it follows the user across devices instead of being stuck to one browser. */
export interface Settings {
  quickLinks: QuickLink[];
  quickLinksCollapsed: boolean;
  sidebarCollapsed: boolean;
  openTabs: string[];
  noteWidthRem: number;
  /** Callout-type (e.g. "tip") -> icon override, keyed by the raw `[!type]` string — a plain
   * emoji/text glyph, or an `img:`-prefixed vault-relative path to an uploaded image. Only holds
   * entries that differ from calloutTypes.ts's own default — the settings UI writes every alias
   * in a shared-icon group at once, never a partial group. */
  calloutIcons: Record<string, string>;
  /** Same shape and grouping convention as `calloutIcons`, but a hex color string instead. */
  calloutColors: Record<string, string>;
  /** Home-page stat bar accent colors, keyed by 'notes' | 'tags' | 'edited' | 'activity' — a hex
   * string. Only holds entries that differ from the component's own built-in defaults, same
   * "empty means default" convention as `calloutColors`. */
  statColors: Record<string, string>;
  /** Per-sport-tag accent colors (keyed by the lowercased `#tag` from a sports-events line, e.g.
   * `"f1"`), used for the Calendar's event pills and the home-page card's glow when that event's
   * sport is tagged. Same "only overrides, not every key" convention as `calloutColors` — an
   * untagged or not-yet-overridden sport falls back to a built-in default or a deterministic
   * per-tag color client-side (see `sportColors.ts`), not to anything stored here. */
  sportColors: Record<string, string>;
  /** Per-sport-tag background image (a vault-relative path under `_Attachments`, same as any
   * uploaded attachment) — rendered fading in from the right edge of the home-page "Next sports
   * event" card when that event's sport is tagged. No entry means no image, not a default one. */
  sportImages: Record<string, string>;
  /** Default volume (0–1) a video/audio download preview starts at — the native player's own
   * volume slider still lets you adjust it per playback from there, same as any `<video>`; this
   * only controls where it starts each time. */
  videoVolume: number;
  /** 'work' hides the home-page unread-mail column (the one showing message previews) for
   * contexts where that'd be visible to other people — the top toolbar's unread-count pill
   * (which only opens the Mail view, never previews a message inline) stays either way. */
  homeMode: 'personal' | 'work';
  /** Sender-matching rules the mail poller (see `mail.ts`'s `startMailRulePoller`) applies to
   * every account's unread mail every 5 minutes, independent of whether the dashboard is even
   * open in a browser. Managed from the Mail view's "Mail rules" panel. */
  mailRules: MailRule[];
  /** Every automatic action a rule has taken, newest first, capped at 100 entries — an audit
   * trail so an auto-delete rule never silently disappears a message with nothing to show for
   * it. Cleared from the same panel. */
  mailRuleLog: MailRuleLogEntry[];
  /** Case-insensitive substrings matched against a Trending-card item's title+meta — anything
   * matching one is filtered out before it's ever shown or logged to a daily note. Populated by
   * clicking "not interested" on a card item (see `trending.ts`'s `extractKeyword`), or typed
   * directly into the Settings modal's "Feed" section. */
  trendingBlockedKeywords: string[];
  /** Case-insensitive substrings matched against a Trending-card item's title+meta — a match
   * gets shown more often in the rotation (see `getTrendingFeed`'s boosting), not filtered.
   * Typed directly into the Settings modal's "Feed" section — there's no auto-extraction path
   * for these the way there is for blocked keywords, since there's no single "item" to extract
   * from when you're describing an interest rather than reacting to something you just saw. */
  trendingInterestKeywords: string[];
  /** User-added RSS/Atom feeds polled alongside Hacker News/GitHub/Lobsters — managed from the
   * Settings modal's "Feed" section. */
  trendingCustomSources: TrendingSource[];
  /** Filename (not a full path) of an uploaded custom site icon, stored server-side in `DATA_DIR`
   * (not the vault, and not browser storage) — served at `GET /api/site-icon`. Null means no
   * custom icon, so the collapsed sidebar rail falls back to the plain "V" glyph. */
  siteIcon: string | null;
}

/** One sender rule: if `pattern` is a case-insensitive substring of a message's From address,
 * `action` fires automatically. `accountAddress` is `'all'` or one specific configured
 * account — same scoping as the existing per-sender "mark as read" action, just persistent and
 * server-driven instead of a one-off click. */
export interface MailRule {
  id: string;
  pattern: string;
  action: 'read' | 'delete';
  accountAddress: string | 'all';
}

/** One row in the mail-rules audit log — what the poller actually did, so a rule (especially a
 * `delete` one) never acts invisibly. */
export interface MailRuleLogEntry {
  id: string;
  at: string;
  accountAddress: string;
  fromAddress: string;
  subject: string;
  action: 'read' | 'delete';
  rulePattern: string;
}
