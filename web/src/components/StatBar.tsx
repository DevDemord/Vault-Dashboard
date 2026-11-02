import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { FxItem, MailStatus, NoteSummary, SportsEvent, Stats, TrendingItem } from '../types';
import { MAIL_LIMIT } from '../mailConstants';
import { buildDayBuckets, formatDay } from './activityHeatmap';
import { hexToRgb } from './calloutTypes';
import { DateRangeModal } from './DateRangeModal';
import { sportColor } from './sportColors';
import { statColor } from './statColors';

const MAIL_POLL_MS = 60_000;
const SPORTS_POLL_MS = 60_000;

/** "Today 19:30", "Tomorrow", "Sat 2 Nov" — relative enough to be useful at a glance, exact
 * enough to actually plan around; falls back to a full date beyond the next few days. For a
 * multi-day event (`endDate` set) this becomes a range, e.g. "Fri 23 Oct – Sun 25 Oct", or just
 * "Today – Sun 25 Oct" if it's already underway. */
function formatEventDay(dateKey: string, now: Date): string {
  const todayKey = now.toISOString().slice(0, 10);
  const tomorrowKey = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  if (dateKey === todayKey) return 'Today';
  if (dateKey === tomorrowKey) return 'Tomorrow';
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatEventWhen(event: SportsEvent): string {
  const now = new Date();
  const startLabel = formatEventDay(event.date, now);
  const start = event.time ? `${startLabel} ${event.time}` : startLabel;
  if (!event.endDate) return start;
  const endLabel = formatEventDay(event.endDate, now);
  const end = event.endTime ? `${endLabel} ${event.endTime}` : endLabel;
  return `${start} – ${end}`;
}

/** Just the local part of an address (before "@") — the full address is too long to fit three
 * of them in one compact card, and the domain is almost always "gmail.com" anyway for this. */
function shortAddress(address: string): string {
  return address.split('@')[0] ?? address;
}

// 4 rows tall rather than a full Sun..Sat week — not calendar-aligned anymore, just the most
// recent N days chunked into columns of 4 — but still the same 90-day window as the full
// Activity page, just wider (23 columns) instead of taller.
const GRID_ROWS = 4;
const COMPACT_DAYS = 90;

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** A corner glow, clipped by the segment's own `overflow-hidden` — painted before the content div
 * in DOM order, but both are `position: relative`, which puts them in the same positioned-paint
 * group so DOM order (glow, then content) decides who's on top instead of the normal-flow rule
 * that would otherwise let an absolutely positioned box paint over static content regardless of
 * markup order. */
function Glow({ hex }: { hex: string }) {
  const rgb = hexToRgb(hex) ?? '167,139,250';
  return (
    <div
      aria-hidden
      className="absolute -left-3 -top-5 h-16 w-16 rounded-full blur-xl"
      style={{ backgroundColor: `rgba(${rgb},0.35)` }}
    />
  );
}

/** A background image pinned to the segment's right edge, fading out toward the left so it blends
 * into the card instead of ending in a hard rectangular edge. Uses a CSS `mask-image` gradient on
 * the image itself (fading its own alpha to 0) rather than painting a second gradient *over* it in
 * some guessed opaque color — the segment's actual background is semi-transparent
 * (`bg-slate-900/40`) over whatever sits behind the page, so any painted-on "opaque" fade color is
 * a guess that won't match and shows up as a hard seam right where the overlay starts. Masking the
 * image's own alpha instead reveals whatever's really there underneath, so it's seamless by
 * construction instead of by lucky color-matching. */
function FadeImage({ relPath }: { relPath: string }) {
  const fade = 'linear-gradient(to right, transparent 0%, black 50%)';
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 w-24 overflow-hidden sm:w-32"
      style={{ WebkitMaskImage: fade, maskImage: fade }}
    >
      <img src={`/api/attachments/${encodeURIComponent(relPath)}`} alt="" className="h-full w-full object-cover" />
    </div>
  );
}

function Segment({
  hex,
  imageRelPath,
  onClick,
  children,
}: {
  hex: string;
  /** Vault-relative path to a background image fading in from the right edge — see `FadeImage`. */
  imageRelPath?: string | null;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className =
    'relative flex min-w-[9rem] flex-1 flex-col items-center overflow-hidden rounded-xl border border-slate-800/70 bg-slate-900/40 px-4 py-3 text-center shadow-sm shadow-black/20';
  const inner = (
    <>
      <Glow hex={hex} />
      {imageRelPath && <FadeImage relPath={imageRelPath} />}
      {/* `w-full` (not `flex-1`, now that the card stacks vertically) keeps this full width
          regardless of the root's `items-center` — which would otherwise shrink a plain block
          child to its own content width and break any full-width row inside (e.g. Mail's
          address/count split, Sports' form inputs). */}
      <div className="relative w-full">{children}</div>
    </>
  );
  return onClick ? (
    <button onClick={onClick} className={className}>
      {inner}
    </button>
  ) : (
    <div className={className}>{inner}</div>
  );
}

/** `hex` colors the heading itself (the card's own accent, same one used for its corner glow) —
 * without it, every card's heading was the same muted gray, so nothing visually set one card
 * apart from another beyond a faint glow in the corner. */
function Label({ hex, children }: { hex?: string; children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: hex ?? '#64748b' }}>
      {children}
    </div>
  );
}

const TRENDING_ROTATE_MS = 7000;
const TRENDING_POLL_MS = 5 * 60_000;
const FX_ROTATE_MS = 6000;
const FX_POLL_MS = 2 * 60_000; // matches the backend's own crypto refresh cadence, its shortest

const TRENDING_BADGE: Partial<Record<TrendingItem['type'], { label: string; className: string }>> = {
  news: { label: 'HN', className: 'bg-orange-500/20 text-orange-300' },
  repo: { label: 'GH', className: 'bg-slate-500/20 text-slate-300' },
  lobsters: { label: 'lobste.rs', className: 'bg-red-500/20 text-red-300' },
};

/** The built-in sources above get a fixed abbreviation/color; a custom RSS/Atom source (added
 * from Settings' "Feed" section) has no hardcoded entry here since its name is whatever the
 * user typed, so it falls back to showing that name directly with a neutral color. */
function trendingBadge(item: TrendingItem): { label: string; className: string } {
  return TRENDING_BADGE[item.type] ?? { label: item.source, className: 'bg-violet-500/20 text-violet-300' };
}

/** Rotates through tech headlines (Hacker News), trending GitHub repos, and top Reddit tech
 * posts — one merged, interleaved list fetched from `/api/trending` (the backend does the actual
 * source polling/caching; this just cycles through whatever it currently has). Pauses on hover so
 * it doesn't rotate out from under you mid-read. */
/** True if `item` would be caught by a block on `keyword` — same substring rule the backend
 * applies (`matchesBlocked` in trending.ts), duplicated client-side only so a freshly-blocked
 * keyword can strip matching items out of what's already loaded immediately, instead of waiting
 * for the next poll. */
function matchesKeyword(item: TrendingItem, keyword: string): boolean {
  return `${item.title} ${item.meta}`.toLowerCase().includes(keyword.toLowerCase());
}

function TrendingCard({ hex }: { hex: string }) {
  const [items, setItems] = useState<TrendingItem[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .trending()
        .then((list) => {
          if (!cancelled) setItems(list);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, TRENDING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    api
      .trendingBlocked()
      .then(setBlocked)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (paused || items.length === 0) return;
    const interval = setInterval(() => setIndex((i) => (i + 1) % items.length), TRENDING_ROTATE_MS);
    return () => clearInterval(interval);
  }, [paused, items.length]);

  const item = items.length > 0 ? items[index % items.length] : null;
  const badge = item ? trendingBadge(item) : null;

  const step = (delta: number) => {
    if (items.length === 0) return;
    setIndex((i) => (i + delta + items.length) % items.length);
  };

  const notInterested = async () => {
    if (!item || blocking) return;
    setBlocking(true);
    try {
      const { keyword } = await api.trendingBlock(item.title);
      setBlocked((b) => (b.includes(keyword) ? b : [...b, keyword]));
      setItems((list) => list.filter((i) => !matchesKeyword(i, keyword)));
      setIndex(0);
    } catch {
      // Best-effort — leave the item showing if the request failed rather than pretending it worked.
    } finally {
      setBlocking(false);
    }
  };

  const unblock = (keyword: string) => {
    api
      .trendingUnblock(keyword)
      .then(setBlocked)
      .catch(() => {});
  };

  return (
    <Segment hex={hex}>
      <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        {item && (
          <button
            onClick={notInterested}
            disabled={blocking}
            title="Not interested — hide items like this"
            className="absolute right-0 top-0 rounded px-1 text-xs text-slate-500 hover:text-red-300 disabled:opacity-50"
          >
            ✕
          </button>
        )}
        <div className="flex items-center justify-center gap-1.5">
          <Label hex={hex}>Trending</Label>
          {badge && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}>{badge.label}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {items.length > 1 && (
            <button
              onClick={() => step(-1)}
              title="Previous"
              className="flex-shrink-0 rounded px-1 text-sm text-slate-500 hover:text-violet-300"
            >
              ‹
            </button>
          )}
          <div className="min-w-0 flex-1">
            {item ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2"
                title={item.title}
              >
                {item.thumbnail && (
                  <img src={item.thumbnail} alt="" className="h-8 w-8 flex-shrink-0 rounded object-cover" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-display text-sm font-semibold text-slate-100">{item.title}</div>
                  <div className="truncate text-xs text-slate-500">{item.meta}</div>
                </div>
              </a>
            ) : (
              <div className="text-xs text-slate-500">Nothing to show right now</div>
            )}
          </div>
          {items.length > 1 && (
            <button
              onClick={() => step(1)}
              title="Next"
              className="flex-shrink-0 rounded px-1 text-sm text-slate-500 hover:text-violet-300"
            >
              ›
            </button>
          )}
        </div>
        {blocked.length > 0 && (
          <button
            onClick={() => setManageOpen((v) => !v)}
            className="mt-1 text-[10px] text-slate-500 hover:text-violet-300"
          >
            {manageOpen ? 'Hide' : 'Manage'} blocked topics ({blocked.length})
          </button>
        )}
        {manageOpen && (
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {blocked.map((kw) => (
              <span key={kw} className="flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                {kw}
                <button onClick={() => unblock(kw)} title={`Stop blocking "${kw}"`} className="text-slate-500 hover:text-red-300">
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </Segment>
  );
}

/** Large crypto prices (BTC in the hundreds of thousands of ZAR) read better without decimals;
 * fiat keeps the original two-decimal convention. */
function formatFxRate(item: FxItem): string {
  if (item.rate == null) return '—';
  const decimals = item.kind === 'crypto' ? 0 : 2;
  return `R${item.rate.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}`;
}

/** A fiat pair's `asOf` is already a plain `YYYY-MM-DD` worth showing as-is; a crypto pair's is a
 * full timestamp (prices move within minutes), so that one reads better relative ("3m ago"). */
function formatFxAsOf(item: FxItem): string {
  if (!item.asOf) return '';
  return item.kind === 'crypto' ? timeAgo(new Date(item.asOf).getTime()) : item.asOf;
}

/** Rotates through EUR/USD/GBP → ZAR and BTC/ETH → ZAR, one merged list fetched from `/api/fx`
 * (the backend does the actual polling — fiat hourly via Frankfurter, crypto every 2 minutes via
 * CoinGecko; see `fx.ts`). Pauses on hover, same as the Trending card; a refresh button forces an
 * immediate re-fetch of both instead of waiting for either's own schedule. */
function FxCard({ hex }: { hex: string }) {
  const [items, setItems] = useState<FxItem[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .fx()
        .then((list) => {
          if (!cancelled) setItems(list);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, FX_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (paused || items.length === 0) return;
    const interval = setInterval(() => setIndex((i) => (i + 1) % items.length), FX_ROTATE_MS);
    return () => clearInterval(interval);
  }, [paused, items.length]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      setItems(await api.fxRefresh());
    } catch {
      // Best-effort — leave whatever's already loaded showing if the request failed.
    } finally {
      setRefreshing(false);
    }
  };

  const item = items.length > 0 ? items[index % items.length] : null;

  const step = (delta: number) => {
    if (items.length === 0) return;
    setIndex((i) => (i + delta + items.length) % items.length);
  };

  return (
    <Segment hex={hex}>
      <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <button
          onClick={refresh}
          disabled={refreshing}
          title="Refresh now"
          className="absolute right-0 top-0 rounded px-1 text-xs text-slate-500 hover:text-violet-300 disabled:opacity-50"
        >
          <span className={refreshing ? 'inline-block animate-spin' : ''}>⟳</span>
        </button>
        <Label hex={hex}>{item ? item.label : 'Exchange rate'}</Label>
        <div className="mt-1 flex items-center gap-2">
          {items.length > 1 && (
            <button
              onClick={() => step(-1)}
              title="Previous"
              className="flex-shrink-0 rounded px-1 text-sm text-slate-500 hover:text-violet-300"
            >
              ‹
            </button>
          )}
          <div className="min-w-0 flex-1 font-display text-xl font-semibold text-slate-100">
            {item?.available && item.rate != null ? formatFxRate(item) : '—'}
          </div>
          {items.length > 1 && (
            <button
              onClick={() => step(1)}
              title="Next"
              className="flex-shrink-0 rounded px-1 text-sm text-slate-500 hover:text-violet-300"
            >
              ›
            </button>
          )}
        </div>
        {item?.available && item.rate != null && (
          <div className="mt-1 text-xs text-slate-500">as of {formatFxAsOf(item)}</div>
        )}
      </div>
    </Segment>
  );
}

/**
 * Home-page stat row — Trending / Exchange rate / Last edited / Activity as four compact cards
 * (option 6's tighter sizing, each still its own outlined card rather than one joined bar), each
 * with a soft corner glow in its own accent color (option 8). Colors come from `statColors`
 * (user-customizable via the Settings modal), falling back to sensible defaults.
 */
export function StatBar({
  stats,
  notes,
  colors,
  sportColors,
  sportImages,
  onViewActivity,
  onViewMail,
  onViewSports,
  onSportsEventAdded,
  homeMode,
}: {
  stats: Stats;
  notes: NoteSummary[];
  colors: Record<string, string>;
  /** `Settings.sportColors` — per-tag overrides; see `sportColors.ts` for the fallback chain. */
  sportColors: Record<string, string>;
  /** `Settings.sportImages` — per-tag background image (vault-relative path), or no entry. */
  sportImages: Record<string, string>;
  onViewActivity: () => void;
  onViewMail: () => void;
  onViewSports: () => void;
  /** Called after a successful quick-add here — this card self-polls its own `nextEvent`, but
   * the app's central `sportsEvents` list (e.g. the Calendar view's data) is only refreshed via
   * this callback, not by this card's own poll. */
  onSportsEventAdded: () => void;
  /** 'work' drops the Mail segment below (it previews sender addresses and unread counts) —
   * same reasoning as the home grid's mail column. */
  homeMode: 'personal' | 'work';
}) {
  const days = useMemo(() => buildDayBuckets(notes, COMPACT_DAYS), [notes]);
  const columns = useMemo(() => {
    const cols = [];
    for (let i = 0; i < days.length; i += GRID_ROWS) cols.push(days.slice(i, i + GRID_ROWS));
    return cols;
  }, [days]);
  const maxDayCount = useMemo(() => days.reduce((m, d) => Math.max(m, d.count), 0), [days]);
  const activityRgb = hexToRgb(statColor(colors, 'activity')) ?? '232,121,249';

  // Self-polled, same as GmailWidget's pill — this card hides itself entirely if no Gmail
  // accounts are configured, same "opt-in, no error for not opting in" convention.
  const [mailStatus, setMailStatus] = useState<MailStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      // Same limit the Mail page itself requests (see mailConstants.ts) so this card's regular
      // background poll keeps that cache entry warm for when the user actually opens the page.
      api
        .mailUnread(MAIL_LIMIT)
        .then((s) => {
          if (!cancelled) setMailStatus(s);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, MAIL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Unlike the Mail card, this one stays visible even with nothing to show — it's also the only
  // discoverable place to add the *first* event (the underlying note doesn't exist yet until
  // then), so hiding it empty would hide its own entry point.
  const [nextEvent, setNextEvent] = useState<SportsEvent | null>(null);
  const loadNextEvent = () => {
    api
      .sportsEvents(1)
      .then((events) => setNextEvent(events[0] ?? null))
      .catch(() => {});
  };
  useEffect(() => {
    loadNextEvent();
    const interval = setInterval(loadNextEvent, SPORTS_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addTime, setAddTime] = useState('');
  const [addEndDate, setAddEndDate] = useState('');
  const [addSport, setAddSport] = useState('');
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const multiDay = Boolean(addEndDate);
  const sportsHex = nextEvent?.sport ? sportColor(sportColors, nextEvent.sport) : statColor(colors, 'sports');

  const submitEvent = async () => {
    const title = addTitle.trim();
    if (!title || !addDate || adding) return;
    if (multiDay && !addEndDate) return;
    setAdding(true);
    setAddError(null);
    try {
      await api.addSportsEvent(title, addDate, addTime.trim() || null, multiDay ? addEndDate : null, addSport.trim() || null);
      setAddTitle('');
      setAddTime('');
      setAddEndDate('');
      setAddSport('');
      setAddOpen(false);
      loadNextEvent();
      onSportsEventAdded();
    } catch {
      setAddError('Could not save that event.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-3">
      <TrendingCard hex={statColor(colors, 'trending')} />

      <FxCard hex={statColor(colors, 'fx')} />

      <Segment hex={statColor(colors, 'edited')}>
        <Label hex={statColor(colors, 'edited')}>Last edited</Label>
        <div className="font-display text-xl font-semibold text-slate-100">
          {stats.lastModified ? timeAgo(stats.lastModified.mtime) : '—'}
        </div>
        {stats.lastModified?.title && <div className="truncate text-xs text-slate-500">{stats.lastModified.title}</div>}
      </Segment>

      <Segment hex={statColor(colors, 'activity')} onClick={onViewActivity}>
        <Label hex={statColor(colors, 'activity')}>Activity</Label>
        <div className="mt-1 flex justify-center gap-[2px]">
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[2px]">
              {col.map((day) => (
                <div
                  key={day.date}
                  title={`${formatDay(day.date)}: ${day.count} note${day.count === 1 ? '' : 's'} edited`}
                  className="h-[7px] w-[7px] rounded-[1px]"
                  style={{
                    backgroundColor:
                      day.count === 0
                        ? 'rgba(148,163,184,0.15)'
                        : `rgba(${activityRgb},${0.25 + (day.count / Math.max(maxDayCount, 1)) * 0.75})`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </Segment>

      {homeMode !== 'work' && mailStatus?.configured && mailStatus.accounts.length > 0 && (
        <Segment hex={statColor(colors, 'mail')} onClick={onViewMail}>
          <Label hex={statColor(colors, 'mail')}>Mail</Label>
          <div className="mt-0.5 flex flex-col gap-0.5">
            {mailStatus.accounts.map((a) => (
              <div key={a.address} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-slate-400">{shortAddress(a.address)}</span>
                <span className={`flex-shrink-0 font-display font-semibold ${a.error ? 'text-red-400' : 'text-slate-100'}`}>
                  {a.error ? '!' : a.count}
                </span>
              </div>
            ))}
          </div>
        </Segment>
      )}

      <Segment hex={sportsHex} imageRelPath={nextEvent?.sport ? sportImages[nextEvent.sport] : null}>
        <div className="relative">
          <button
            onClick={() => setAddOpen((v) => !v)}
            title="Add a sports event"
            className="absolute right-0 top-0 rounded px-1 text-xs text-slate-500 hover:text-violet-300"
          >
            {addOpen ? '✕' : '+'}
          </button>
          <Label hex={sportsHex}>Next sports event</Label>
        </div>

        {!addOpen &&
          (nextEvent ? (
            <button onClick={onViewSports} className="mt-1 block w-full text-center">
              <div className="truncate font-display text-sm font-semibold text-slate-100">{nextEvent.title}</div>
              <div className="text-xs text-slate-500">{formatEventWhen(nextEvent)}</div>
            </button>
          ) : (
            <button
              onClick={() => setAddOpen(true)}
              className="mt-1 block w-full text-center text-xs text-slate-500 hover:text-violet-300"
            >
              No upcoming events — add one
            </button>
          ))}

        {addOpen && (
          <div className="mt-1 flex flex-col gap-1.5">
            <input
              autoFocus
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitEvent()}
              placeholder="Lakers vs Celtics…"
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            <div className="flex gap-1.5">
              {!multiDay && (
                <input
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                  className="w-1/2 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-100 focus:border-violet-500 focus:outline-none"
                />
              )}
              <input
                type="time"
                value={addTime}
                onChange={(e) => setAddTime(e.target.value)}
                className={`rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-100 focus:border-violet-500 focus:outline-none ${multiDay ? 'w-full' : 'w-1/2'}`}
              />
            </div>
            <input
              value={addSport}
              onChange={(e) => setAddSport(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitEvent()}
              placeholder="Sport tag (f1, cs2, rugby…)"
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            {multiDay ? (
              <button
                onClick={() => setRangeModalOpen(true)}
                className="flex items-center justify-between rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 hover:border-violet-500/50"
              >
                <span>
                  📅 {addDate} → {addEndDate}
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddEndDate('');
                  }}
                  title="Make this a single-day event"
                  className="text-slate-500 hover:text-red-300"
                >
                  ✕
                </span>
              </button>
            ) : (
              <button
                onClick={() => setRangeModalOpen(true)}
                className="text-left text-xs text-slate-500 hover:text-violet-300"
              >
                + Multi-day event (e.g. a race weekend)
              </button>
            )}
            <button
              onClick={() => void submitEvent()}
              disabled={adding || !addTitle.trim() || (multiDay && !addEndDate)}
              className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {adding ? 'Saving…' : 'Save event'}
            </button>
            {addError && <div className="text-xs text-red-300">{addError}</div>}
          </div>
        )}
      </Segment>

      {rangeModalOpen && (
        <DateRangeModal
          initialStart={addDate}
          initialEnd={addEndDate || null}
          onClose={() => setRangeModalOpen(false)}
          onApply={(start, end) => {
            setAddDate(start);
            setAddEndDate(end);
            setRangeModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
