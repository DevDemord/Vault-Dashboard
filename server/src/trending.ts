import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { readSettings, writeSettings } from './settings.js';
import { ValidationError } from './vault.js';
import type { TrendingItem, TrendingSource } from './types.js';

const FETCH_TIMEOUT_MS = 12000;
const USER_AGENT = 'Mozilla/5.0 (compatible; VaultDashboard/1.0)';
const DATA_DIR = process.env.DATA_DIR ?? '/app/data';
const SEEN_FILE = path.join(DATA_DIR, 'trending-seen.json');
// Caps how many URLs we remember having already logged — comfortably more than a day's worth
// across all sources, so a restart never re-floods the daily note with stuff from yesterday, but
// it doesn't grow forever either.
const MAX_SEEN = 1500;

// Each source refreshes on its own cadence — HN/Lobsters move within the hour, GitHub's "created
// this week, sorted by stars" proxy for trending barely moves hour to hour, so there's no reason
// to hit it as often (and it's more likely to get unauthenticated-rate-limited if we do). Custom
// RSS/Atom feeds get the same cadence as HN/Lobsters — a reasonable default for a blog/subreddit,
// with no per-source way to tune it yet.
const HN_POLL_MS = 20 * 60_000;
const LOBSTERS_POLL_MS = 20 * 60_000;
const GITHUB_POLL_MS = 6 * 60 * 60_000;
const CUSTOM_POLL_MS = 20 * 60_000;
const CUSTOM_ITEM_LIMIT = 12;

let hnItems: TrendingItem[] = [];
let lobstersItems: TrendingItem[] = [];
let githubItems: TrendingItem[] = [];
// One entry per user-added RSS/Atom source, keyed by its `TrendingSource.id` — unlike the three
// built-ins above, this list grows/shrinks at runtime as sources are added/removed from Settings.
const customItems = new Map<string, TrendingItem[]>();
const customTimers = new Map<string, ReturnType<typeof setInterval>>();
let pollerStarted = false;

let seenUrls = new Set<string>();
let seenLoaded = false;
type NewItemsHandler = (items: TrendingItem[], source: string) => void;
let onNewItems: NewItemsHandler | null = null;

async function loadSeen(): Promise<void> {
  if (seenLoaded) return;
  seenLoaded = true;
  try {
    const raw = await fs.readFile(SEEN_FILE, 'utf8');
    seenUrls = new Set(JSON.parse(raw));
  } catch {
    seenUrls = new Set();
  }
}

async function saveSeen(): Promise<void> {
  const arr = [...seenUrls].slice(-MAX_SEEN);
  seenUrls = new Set(arr);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SEEN_FILE, JSON.stringify(arr));
}

/** Diffs a freshly-fetched source list against every URL we've ever logged before (across every
 * source, persisted to disk so a container restart doesn't re-announce yesterday's items), and
 * hands only the genuinely-new ones to `onNewItems` along with that source's display name — the
 * callback `index.ts` wires up to append them into today's daily note, grouped by provider. A
 * story that's been sitting on HN's front page for hours gets fetched again every poll but only
 * ever notified once, the first time it's seen. */
async function recordAndNotify(items: TrendingItem[], source: string): Promise<void> {
  await loadSeen();
  const fresh = items.filter((i) => !seenUrls.has(i.url));
  if (fresh.length === 0) return;
  for (const i of fresh) seenUrls.add(i.url);
  await saveSeen();
  onNewItems?.(fresh, source);
}

// Filtered out of keyword extraction below — ordinary grammar words plus generic headline/report
// filler ("announced", "research", "latest", ...) that would over-block if picked as "the"
// distinctive word in a title: these are long enough to pass the length check and common enough
// to show up in nearly every third headline, so picking one as a block keyword would end up
// silently hiding huge swaths of unrelated stories instead of just the one topic.
const STOPWORD_SET = new Set([
  'about',
  'according',
  'after',
  'again',
  'announce',
  'announced',
  'announcement',
  'announcing',
  'announces',
  'because',
  'before',
  'being',
  'better',
  'billion',
  'breaking',
  'building',
  'builds',
  'built',
  'claim',
  'claimed',
  'claims',
  'companies',
  'company',
  'comes',
  'coming',
  'could',
  'days',
  'detail',
  'details',
  'discover',
  'discoveries',
  'discovery',
  'every',
  'feature',
  'features',
  'first',
  'found',
  'from',
  'getting',
  'global',
  'guide',
  'have',
  'here',
  'house',
  'into',
  'introduce',
  'introduces',
  'introducing',
  'just',
  'latest',
  'launch',
  'launched',
  'launches',
  'major',
  'makes',
  'making',
  'million',
  'month',
  'more',
  'most',
  'much',
  'never',
  'news',
  'official',
  'officially',
  'only',
  'open',
  'other',
  'over',
  'people',
  'percent',
  'project',
  'public',
  'really',
  'release',
  'released',
  'releases',
  'report',
  'reported',
  'reports',
  'research',
  'researchers',
  'reveal',
  'revealed',
  'reveals',
  'review',
  'says',
  'shows',
  'since',
  'some',
  'source',
  'sources',
  'should',
  'show',
  'startup',
  'still',
  'story',
  'stories',
  'studies',
  'study',
  'than',
  'that',
  'their',
  'there',
  'these',
  'they',
  'this',
  'through',
  'today',
  'unveil',
  'unveiled',
  'unveils',
  'update',
  'updated',
  'updates',
  'using',
  'version',
  'very',
  'want',
  'week',
  'what',
  'when',
  'where',
  'which',
  'while',
  'will',
  'with',
  'world',
  'would',
  'year',
  'years',
  'yesterday',
  'your',
]);

/** Picks one "distinctive" word out of a title to use as a block keyword. Prefers a word with a
 * proper-noun signal: either capitalized *and not the title's own first word* (mid-sentence
 * capitalization is a much stronger signal — "... about Bitcoin prices" — than sentence-initial
 * capitalization, which is just English grammar and tells us nothing; "Three new discoveries..."
 * would otherwise pick "Three"), or a lowercase-then-uppercase letter pair anywhere in the word
 * ("iPad", "iPhone", "macOS"), which catches brand names that don't start with a capital even at
 * the very start of a title. Falls back to the longest remaining word after stripping
 * grammar/filler words. This is a one-word heuristic, not real topic extraction — clicking "not
 * interested" on one item won't instantly block every related one, but it compounds: each click
 * narrows the feed a bit further, which is the deliberate tradeoff for not needing a real topic
 * classifier here. */
export function extractKeyword(title: string): string {
  const rawWords = title.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const candidates = rawWords
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w.length >= 4 && !STOPWORD_SET.has(w.toLowerCase()));
  if (candidates.length === 0) return title.trim().slice(0, 40).toLowerCase();
  const properNoun = candidates.find(
    ({ w, i }) => (i > 0 && /^[A-Z]/.test(w) && w.toLowerCase() !== w) || /[a-z][A-Z]/.test(w),
  );
  const chosen = properNoun?.w ?? candidates.reduce((a, b) => (b.w.length > a.w.length ? b : a)).w;
  return chosen.toLowerCase();
}

/** Case-insensitive substring match of any `keywords` entry against an item's title+meta — the
 * one check shared by block-filtering and interest-boosting below; which list you pass in is
 * what decides what the match means. */
function matchesAnyKeyword(item: TrendingItem, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const haystack = `${item.title} ${item.meta}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

async function filterBlocked(items: TrendingItem[]): Promise<TrendingItem[]> {
  const settings = await readSettings();
  const blocked = settings.trendingBlockedKeywords ?? [];
  if (blocked.length === 0) return items;
  return items.filter((i) => !matchesAnyKeyword(i, blocked));
}

/** Adds one keyword to the persisted blocklist (deduped, case-insensitive) and strips any
 * already-cached item matching it, so the rotator stops showing related items immediately
 * rather than waiting for the next poll. Shared by the card's title-extraction path
 * (`blockKeywordFromTitle`) and the Settings modal's direct-typed one (`addBlockedKeyword`). */
async function addKeywordToBlocklist(keyword: string): Promise<string[]> {
  const settings = await readSettings();
  const current = settings.trendingBlockedKeywords ?? [];
  const updated = current.some((k) => k.toLowerCase() === keyword.toLowerCase())
    ? current
    : (await writeSettings({ trendingBlockedKeywords: [...current, keyword] })).trendingBlockedKeywords;
  hnItems = hnItems.filter((i) => !matchesAnyKeyword(i, [keyword]));
  githubItems = githubItems.filter((i) => !matchesAnyKeyword(i, [keyword]));
  lobstersItems = lobstersItems.filter((i) => !matchesAnyKeyword(i, [keyword]));
  for (const [id, items] of customItems) {
    customItems.set(id, items.filter((i) => !matchesAnyKeyword(i, [keyword])));
  }
  return updated;
}

/** Called when the user clicks "not interested" on a Trending card item — extracts a keyword
 * from its title and blocks it. Returns the keyword chosen, so the frontend can confirm what got
 * blocked (there's no title to extract from for a keyword typed directly into Settings — see
 * `addBlockedKeyword` for that path). */
export async function blockKeywordFromTitle(title: string): Promise<string> {
  const keyword = extractKeyword(title);
  await addKeywordToBlocklist(keyword);
  return keyword;
}

/** Called from the Settings modal's "Feed" section — blocks a keyword the user typed directly,
 * no extraction involved. Returns the full updated list, same shape as `unblockKeyword`. */
export async function addBlockedKeyword(keyword: string): Promise<string[]> {
  return addKeywordToBlocklist(keyword.trim().toLowerCase());
}

/** Removes one keyword from the blocklist — lets a misclick (or a change of heart) be undone;
 * does not retroactively bring back anything already filtered out of the live lists, only stops
 * filtering on future polls. */
export async function unblockKeyword(keyword: string): Promise<string[]> {
  const settings = await readSettings();
  const next = (settings.trendingBlockedKeywords ?? []).filter((k) => k.toLowerCase() !== keyword.toLowerCase());
  const updated = await writeSettings({ trendingBlockedKeywords: next });
  return updated.trendingBlockedKeywords;
}

export async function listBlockedKeywords(): Promise<string[]> {
  const settings = await readSettings();
  return settings.trendingBlockedKeywords ?? [];
}

/** Adds a keyword to the persisted interest list (deduped, case-insensitive) — see
 * `getTrendingFeed`'s boosting for what this actually does to the rotation. Unlike blocking,
 * there's nothing to strip from the live lists here; a new interest can only make something show
 * up *more*, never less, so there's no "already loaded, now stale" item to clean up. */
export async function addInterestKeyword(keyword: string): Promise<string[]> {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return listInterestKeywords();
  const settings = await readSettings();
  const current = settings.trendingInterestKeywords ?? [];
  if (current.some((k) => k.toLowerCase() === kw)) return current;
  const updated = await writeSettings({ trendingInterestKeywords: [...current, kw] });
  return updated.trendingInterestKeywords;
}

export async function removeInterestKeyword(keyword: string): Promise<string[]> {
  const settings = await readSettings();
  const next = (settings.trendingInterestKeywords ?? []).filter((k) => k.toLowerCase() !== keyword.toLowerCase());
  const updated = await writeSettings({ trendingInterestKeywords: next });
  return updated.trendingInterestKeywords;
}

export async function listInterestKeywords(): Promise<string[]> {
  const settings = await readSettings();
  return settings.trendingInterestKeywords ?? [];
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Hacker News front page via Algolia's public search API — no key, no auth. */
async function refreshHackerNews(): Promise<void> {
  const data = await fetchJson('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=12', {
    'user-agent': USER_AGENT,
  });
  const mapped = (data.hits ?? [])
    .filter((h: any) => h.title)
    .map((h: any) => ({
      type: 'news' as const,
      source: 'Hacker News',
      title: h.title as string,
      // Text/Ask-HN posts have no `url` — fall back to the HN discussion page itself.
      url: (h.url as string | null) ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      meta: `${h.points ?? 0} points`,
      thumbnail: null,
    }));
  hnItems = await filterBlocked(mapped);
  await recordAndNotify(hnItems, 'Hacker News');
}

/** GitHub has no public "trending" API — this approximates it with the Search API (repos
 * created in the last week, sorted by stars), which is officially supported and key-free at this
 * call volume (one request every few hours, well under the 60/hr unauthenticated cap). */
async function refreshGithubTrending(): Promise<void> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const data = await fetchJson(
    `https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=12`,
    { 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' },
  );
  const mapped = (data.items ?? []).map((r: any) => ({
    type: 'repo' as const,
    source: 'GitHub',
    title: r.full_name as string,
    url: r.html_url as string,
    meta: [r.language, `★ ${r.stargazers_count}`].filter(Boolean).join(' · '),
    thumbnail: null,
  }));
  githubItems = await filterBlocked(mapped);
  await recordAndNotify(githubItems, 'GitHub');
}

/** Lobsters' public "hottest" feed — a small tech-community link aggregator (programming,
 * systems, security). Chosen over Reddit's JSON/RSS endpoints, which actively block non-browser
 * requests (403s) regardless of user-agent; Lobsters' API is documented and open, no key or UA
 * tricks needed. */
async function refreshLobsters(): Promise<void> {
  const data = await fetchJson('https://lobste.rs/hottest.json', { 'user-agent': USER_AGENT });
  const mapped = (Array.isArray(data) ? data : [])
    .slice(0, 12)
    .filter((d: any) => d?.title)
    .map((d: any) => ({
      type: 'lobsters' as const,
      source: 'Lobsters',
      title: d.title as string,
      // Most stories link out to the real source; a text/Ask-style post has no `url`, so fall
      // back to the Lobsters discussion page itself (same pattern as HN's text posts above).
      url: (d.url as string | null) || (d.comments_url as string),
      meta: `${d.score ?? 0} points`,
      thumbnail: null,
    }));
  lobstersItems = await filterBlocked(mapped);
  await recordAndNotify(lobstersItems, 'Lobsters');
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '') // strip any stray inline markup (titles are occasionally HTML, not plain text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractXmlTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeXmlEntities(m[1]) : null;
}

/** Atom's `<link>` is a self-closing tag with the URL in an `href` attribute (possibly several,
 * one per `rel`) rather than RSS's plain `<link>url</link>` text content — prefers `rel="alternate"`
 * (the human-readable page) over any other rel (e.g. `self`, `enclosure`). */
function extractAtomLink(block: string): string | null {
  const candidates = [...block.matchAll(/<link\b([^>]*)\/?>/gi)]
    .map((m) => {
      const attrs = m[1];
      const href = attrs.match(/href="([^"]*)"/)?.[1];
      const rel = attrs.match(/rel="([^"]*)"/)?.[1] ?? 'alternate';
      return href ? { href, rel } : null;
    })
    .filter((c): c is { href: string; rel: string } => c !== null);
  return candidates.find((c) => c.rel === 'alternate')?.href ?? candidates[0]?.href ?? null;
}

/** Minimal, forgiving RSS 2.0 / Atom feed parser — just enough structure (title + link) to feed
 * the rotator, via regex over the raw XML rather than a full parser/new dependency, matching how
 * the rest of this codebase already hand-extracts structured text (see `extractChecklistItems`
 * in markdown.ts). Good enough for the common case; an unusual feed dialect (RDF, odd namespaces)
 * may yield zero items, which `addCustomSource` below treats as a validation failure rather than
 * silently saving a dead source. */
function parseFeedItems(xml: string, limit: number): { title: string; url: string }[] {
  const items: { title: string; url: string }[] = [];
  const blockRe = /<item\b[^>]*>([\s\S]*?)<\/item>|<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) && items.length < limit) {
    const block = m[1] ?? m[2] ?? '';
    const title = extractXmlTag(block, 'title');
    const url = extractAtomLink(block) ?? extractXmlTag(block, 'link');
    if (title && url) items.push({ title, url: url.trim() });
  }
  return items;
}

/** Fetches and refreshes one user-added RSS/Atom source — same shape as the three built-in
 * `refresh*` functions above, just data-driven instead of hardcoded. Thrown errors propagate to
 * the caller: `addCustomSource` needs that to validate a new source on add, while the recurring
 * poller (`startTrendingPoller`) catches and logs it like any other source's failure. */
async function refreshCustomSource(source: TrendingSource): Promise<TrendingItem[]> {
  const xml = await fetchText(source.url, {
    'user-agent': USER_AGENT,
    accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1',
  });
  const entries = parseFeedItems(xml, CUSTOM_ITEM_LIMIT);
  if (entries.length === 0) {
    throw new Error('Fetched that URL but found no RSS/Atom items in it — is it really a feed URL?');
  }
  const mapped: TrendingItem[] = entries.map((e) => ({
    type: 'custom',
    source: source.name,
    title: e.title,
    url: e.url,
    meta: '',
    thumbnail: null,
  }));
  const filtered = await filterBlocked(mapped);
  customItems.set(source.id, filtered);
  await recordAndNotify(filtered, source.name);
  return filtered;
}

function stopCustomSourcePoll(id: string): void {
  const timer = customTimers.get(id);
  if (timer) clearInterval(timer);
  customTimers.delete(id);
}

function startCustomSourcePoll(source: TrendingSource): void {
  stopCustomSourcePoll(source.id);
  const timer = setInterval(() => {
    refreshCustomSource(source).catch((err) => logFailure(source.name, err));
  }, CUSTOM_POLL_MS);
  customTimers.set(source.id, timer);
}

export async function listCustomSources(): Promise<TrendingSource[]> {
  const settings = await readSettings();
  return settings.trendingCustomSources ?? [];
}

/** Adds a new RSS/Atom source — validated by actually fetching and parsing it once before
 * persisting anything, so a feed that 403s (Reddit's own JSON/RSS endpoints block non-browser
 * requests outright, regardless of user-agent — see `refreshLobsters`'s comment) or isn't really
 * a feed fails loudly here instead of silently sitting dead in the list forever. */
export async function addCustomSource(name: string, url: string): Promise<TrendingSource[]> {
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  if (!trimmedName) throw new ValidationError('A name is required.');
  if (!/^https?:\/\/\S+$/.test(trimmedUrl)) throw new ValidationError("That doesn't look like a valid http(s) URL.");

  const source: TrendingSource = { id: randomUUID(), name: trimmedName, url: trimmedUrl };
  try {
    await refreshCustomSource(source);
  } catch (err) {
    throw new ValidationError(
      `Could not add "${trimmedName}": ${err instanceof Error ? err.message : 'the fetch failed'}. Some sites ` +
        `(Reddit among them) block non-browser requests outright, regardless of what this app sends.`,
    );
  }

  const settings = await readSettings();
  const current = settings.trendingCustomSources ?? [];
  const updated = await writeSettings({ trendingCustomSources: [...current, source] });
  startCustomSourcePoll(source);
  return updated.trendingCustomSources;
}

export async function removeCustomSource(id: string): Promise<TrendingSource[]> {
  stopCustomSourcePoll(id);
  customItems.delete(id);
  const settings = await readSettings();
  const next = (settings.trendingCustomSources ?? []).filter((s) => s.id !== id);
  const updated = await writeSettings({ trendingCustomSources: next });
  return updated.trendingCustomSources;
}

/** Renders one item as a markdown bullet's contents — a plain `[title](url)` link plus its meta
 * line (omitted for a custom-feed item with no score/points concept), escaping `[`/`]` in the
 * title so a title that happens to contain a bracket (not unusual for a GitHub repo description
 * or an HN title) can't break the link syntax. */
export function toTrendingFeedLine(item: TrendingItem): string {
  const safeTitle = item.title.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  return item.meta ? `[${safeTitle}](${item.url}) — ${item.meta}` : `[${safeTitle}](${item.url})`;
}

function logFailure(source: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[trending] ${source} refresh failed:`, err);
}

/** `handler` is called with just the newly-appeared items each time any source refreshes — see
 * `recordAndNotify`. `index.ts` wires this up to append them into the dedicated Trending feed
 * note. Also resumes polling every custom source already saved in Settings, so a container
 * restart doesn't silently stop pulling from a feed the user added before it. */
export function startTrendingPoller(handler?: NewItemsHandler): void {
  if (pollerStarted) return;
  pollerStarted = true;
  onNewItems = handler ?? null;

  const run = (name: string, fn: () => Promise<void>) => {
    fn().catch((err) => logFailure(name, err));
  };

  run('hn', refreshHackerNews);
  run('lobsters', refreshLobsters);
  run('github', refreshGithubTrending);
  setInterval(() => run('hn', refreshHackerNews), HN_POLL_MS);
  setInterval(() => run('lobsters', refreshLobsters), LOBSTERS_POLL_MS);
  setInterval(() => run('github', refreshGithubTrending), GITHUB_POLL_MS);

  listCustomSources()
    .then((sources) => {
      for (const source of sources) {
        refreshCustomSource(source).catch((err) => logFailure(source.name, err));
        startCustomSourcePoll(source);
      }
    })
    .catch((err) => logFailure('custom-sources-init', err));
}

/** Interleaves every source (built-in and custom alike) round-robin rather than concatenating
 * them, so the frontend's rotator doesn't sit on one source for a long run just because that
 * source's list happened to come first. Then, if there are any interest keywords, duplicates
 * every matching item once more into the mix — a plain reorder wouldn't actually change how
 * often something shows over a full rotation cycle, just when, so duplicating is what makes a
 * boosted topic genuinely show up more often instead of merely earlier. */
export async function getTrendingFeed(): Promise<TrendingItem[]> {
  const lists = [hnItems, githubItems, lobstersItems, ...customItems.values()];
  const merged: TrendingItem[] = [];
  const maxLen = Math.max(...lists.map((l) => l.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (list[i]) merged.push(list[i]);
    }
  }

  const settings = await readSettings();
  const interests = settings.trendingInterestKeywords ?? [];
  if (interests.length === 0) return merged;
  const boosted = merged.filter((item) => matchesAnyKeyword(item, interests));
  if (boosted.length === 0) return merged;
  const rest = merged.filter((item) => !matchesAnyKeyword(item, interests));
  return [...boosted, ...boosted, ...rest];
}
