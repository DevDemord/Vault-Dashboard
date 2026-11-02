export interface NoteSummary {
  relPath: string;
  title: string;
  folder: string;
  tags: string[];
  mtime: number;
  excerpt: string;
  wordCount: number;
}

export interface SearchResult extends NoteSummary {
  score: number;
}

export interface NoteDetail extends NoteSummary {
  frontmatter: Record<string, unknown>;
  renderedBody: string;
  backlinks: NoteSummary[];
  outgoingLinks: { alias: string; resolvedPath: string | null; raw: string }[];
}

export interface Stats {
  noteCount: number;
  tagCount: number;
  folderCount: number;
  lastModified: NoteSummary | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface ChecklistItem {
  done: boolean;
  text: string;
  group: string | null;
  sourcePath: string;
  sourceTitle: string;
  line: number;
  mtime: number;
}

export interface BookmarkItem extends ChecklistItem {
  url: string;
}

/** One line from the dedicated `_Templates/sports-events.md` note. `date` is `YYYY-MM-DD`; `time`
 * (`HH:MM`, 24h) is null for an all-day/date-only event. `endDate`/`endTime` are set only for a
 * multi-day event (e.g. a race weekend) — null means the event is just the one day. `sport` is a
 * lowercased tag (e.g. `"f1"`) from an optional trailing `#tag` — null for an untagged event. */
export interface SportsEvent {
  title: string;
  date: string;
  time: string | null;
  endDate: string | null;
  endTime: string | null;
  sport: string | null;
  line: number;
}

/** One dated group of bullets from `_Templates/claude-activity-log.md`, newest date first. */
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

export interface GraphNode {
  id: string;
  title: string;
  folder: string;
  tags: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface DuplicatePair {
  a: NoteSummary;
  b: NoteSummary;
  similarity: number;
}

export interface DeadAttachment {
  relPath: string;
  size: number;
}

export interface VersionMeta {
  ts: number;
}

export interface VaultFolderSize {
  folder: string;
  bytes: number;
}

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

export interface MailMessage {
  uid: number;
  subject: string;
  from: string;
  fromAddress: string;
  date: string;
}

export interface MailAccountStatus {
  address: string;
  count: number;
  messages: MailMessage[];
  error?: string;
}

export interface MailStatus {
  configured: boolean;
  accounts: MailAccountStatus[];
}

export interface TrendingItem {
  type: 'news' | 'repo' | 'lobsters' | 'custom';
  /** Human-readable provider name — "Hacker News", "GitHub", "Lobsters", or a custom source's
   * own name. */
  source: string;
  title: string;
  url: string;
  meta: string;
  thumbnail: string | null;
}

export interface TrendingSource {
  id: string;
  name: string;
  url: string;
}

/** One fiat or crypto pair the exchange-rate card rotates through, priced in ZAR. A fiat pair's
 * `asOf` is `YYYY-MM-DD`; a crypto pair's is a full ISO timestamp. */
export interface FxItem {
  id: string;
  label: string;
  kind: 'fiat' | 'crypto';
  rate: number | null;
  asOf: string | null;
  available: boolean;
  error: string | null;
}

export interface MailFolder {
  path: string;
  name: string;
  specialUse?: string;
}

export interface MailMessageBody {
  subject: string;
  from: string;
  to: string;
  date: string;
  html: string | null;
  text: string | null;
}

/** One row from the separate IG/downloader dashboard (port 3011). `status` mirrors that app's own
 * values verbatim ('downloading' | 'done' | 'failed'). */
export interface DownloadSummary {
  id: string;
  url: string;
  status: string;
  title: string | null;
  author: string | null;
  thumbUrl: string | null;
  mediaUrl: string | null;
  mediaType: 'video' | 'image' | 'audio' | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface QuickLink {
  id: string;
  label: string;
  url: string;
  icon?: string;
}

/** Server-side now (was localStorage) so it follows the user across devices/browsers. */
export interface Settings {
  quickLinks: QuickLink[];
  quickLinksCollapsed: boolean;
  sidebarCollapsed: boolean;
  openTabs: string[];
  noteWidthRem: number;
  calloutIcons: Record<string, string>;
  calloutColors: Record<string, string>;
  statColors: Record<string, string>;
  /** Per-sport-tag accent colors (keyed by a sports-event's lowercased `#tag`, e.g. `"f1"`). */
  sportColors: Record<string, string>;
  /** Per-sport-tag background image (a vault-relative path under `_Attachments`) for the
   * home-page "Next sports event" card. No entry means no image. */
  sportImages: Record<string, string>;
  /** Default volume (0–1) a video/audio download preview starts at. */
  videoVolume: number;
  /** 'work' hides the home-page unread-mail column; the top toolbar's unread-count pill stays
   * either way (it only opens the Mail view, never previews a message inline). */
  homeMode: 'personal' | 'work';
  /** Sender rules the server-side poller applies to unread mail every 5 minutes, independent
   * of this app being open. Managed from the Mail view's "Mail rules" panel. */
  mailRules: MailRule[];
  /** Every automatic action a rule has taken, newest first, capped at 100 — an audit trail. */
  mailRuleLog: MailRuleLogEntry[];
  trendingBlockedKeywords: string[];
  trendingInterestKeywords: string[];
  trendingCustomSources: TrendingSource[];
  /** Filename of an uploaded custom site icon, server-stored — null means the plain "V" glyph. */
  siteIcon: string | null;
}

export interface MailRule {
  id: string;
  pattern: string;
  action: 'read' | 'delete';
  accountAddress: string | 'all';
}

export interface MailRuleLogEntry {
  id: string;
  at: string;
  accountAddress: string;
  fromAddress: string;
  subject: string;
  action: 'read' | 'delete';
  rulePattern: string;
}
