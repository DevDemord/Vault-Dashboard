/** Sensible defaults for a few common sport/series tags, so tagging an event `#f1` or `#cs2` looks
 * right immediately without the user having to open Settings first. Anything not listed here still
 * gets a color (see `hashColor` below) — this is just a nicer starting point for the obvious ones. */
const BUILTIN_SPORT_COLORS: Record<string, string> = {
  f1: '#ef4444',
  motogp: '#f97316',
  cs2: '#f97316',
  csgo: '#f97316',
  valorant: '#fb7185',
  rugby: '#22c55e',
  football: '#3b82f6',
  soccer: '#3b82f6',
  nba: '#fb923c',
  nfl: '#8b5cf6',
  tennis: '#eab308',
  cricket: '#06b6d4',
  golf: '#10b981',
  f1academy: '#ef4444',
};

/** A small palette to hash any *other* tag into — distinct, readable against the dark background,
 * and stable across reloads since the hash is purely a function of the tag string itself. */
const FALLBACK_PALETTE = ['#f472b6', '#38bdf8', '#a3e635', '#fb7185', '#2dd4bf', '#facc15', '#c084fc', '#fdba74'];

function hashColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

/** The color a given sport tag should render in: a user override from Settings first, then a
 * built-in default for a handful of common tags, then a deterministic per-tag fallback — so every
 * distinct tag looks distinct even before the user has configured anything. `colors` (from
 * `Settings.sportColors`) only holds entries that differ from what this function would otherwise
 * return, same "only overrides" convention as `calloutColors`/`statColors`. */
export function sportColor(colors: Record<string, string>, sport: string): string {
  return colors[sport] || BUILTIN_SPORT_COLORS[sport] || hashColor(sport);
}
