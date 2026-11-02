export type StatColorKey = 'trending' | 'fx' | 'edited' | 'activity' | 'mail' | 'sports';

export const STAT_COLOR_KEYS: StatColorKey[] = ['trending', 'fx', 'edited', 'activity', 'mail', 'sports'];

export const STAT_COLOR_LABELS: Record<StatColorKey, string> = {
  trending: 'Trending',
  fx: 'Exchange rate',
  edited: 'Last edited',
  activity: 'Activity',
  mail: 'Mail',
  sports: 'Sports',
};

export const DEFAULT_STAT_COLORS: Record<StatColorKey, string> = {
  trending: '#a78bfa',
  fx: '#22d3ee',
  edited: '#34d399',
  activity: '#e879f9',
  mail: '#fbbf24',
  sports: '#fb7185',
};

/** `statColors` from settings only holds entries that differ from the default (same convention as
 * `calloutColors`), so callers always go through this rather than indexing the record directly. */
export function statColor(colors: Record<string, string>, key: StatColorKey): string {
  return colors[key] || DEFAULT_STAT_COLORS[key];
}
