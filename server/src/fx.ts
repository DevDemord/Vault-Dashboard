import type { FxItem } from './types.js';

const FETCH_TIMEOUT_MS = 12000;
// Frankfurter publishes ECB reference rates once per weekday — polling more often than hourly
// would just re-fetch the same number.
const FIAT_POLL_MS = 60 * 60_000;
// Crypto actually moves within minutes, so it gets its own, much shorter cadence.
const CRYPTO_POLL_MS = 2 * 60_000;
// A manual refresh too soon after the last one (fiat or crypto) just re-serves the cached items
// rather than re-hitting either upstream API — mostly to stop an accidental double-click from
// burning through CoinGecko's free-tier rate limit, which is strict for unauthenticated calls.
const REFRESH_COOLDOWN_MS = 5000;

const FIAT_CODES = ['EUR', 'USD', 'GBP'] as const;
const CRYPTO_COINS: { id: string; label: string }[] = [
  { id: 'bitcoin', label: 'BTC' },
  { id: 'ethereum', label: 'ETH' },
];

function fiatItemId(code: string): string {
  return `${code.toLowerCase()}-zar`;
}
function cryptoItemId(label: string): string {
  return `${label.toLowerCase()}-zar`;
}

// A plain object (not a Map) so insertion order — EUR, USD, GBP, BTC, ETH — is both the initial
// seed order and what a re-`set` on refresh preserves, giving the card a stable rotation order
// for free without a separate ordering field.
const items: Record<string, FxItem> = {};
for (const code of FIAT_CODES) {
  items[fiatItemId(code)] = {
    id: fiatItemId(code),
    label: `${code} → ZAR`,
    kind: 'fiat',
    rate: null,
    asOf: null,
    available: false,
    error: 'Not fetched yet',
  };
}
for (const coin of CRYPTO_COINS) {
  items[cryptoItemId(coin.label)] = {
    id: cryptoItemId(coin.label),
    label: `${coin.label} → ZAR`,
    kind: 'crypto',
    rate: null,
    asOf: null,
    available: false,
    error: 'Not fetched yet',
  };
}

let lastRefreshAt = 0;

/** EUR/USD/GBP → ZAR via Frankfurter (frankfurter.app) — free, no API key, backed by the ECB's
 * own daily reference rates. One call with `from=ZAR` covers all three at once; Frankfurter
 * always expresses the rate as "amount of `to` per 1 `from`", so each result gets inverted back
 * to "ZAR per 1 <code>" to match the card's existing EUR→ZAR convention. */
async function refreshFiat(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const to = FIAT_CODES.join(',');
    const res = await fetch(`https://api.frankfurter.app/latest?from=ZAR&to=${to}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`frankfurter -> ${res.status}`);
    const data = (await res.json()) as { date: string; rates: Record<string, number> };
    for (const code of FIAT_CODES) {
      const perZar = data.rates?.[code];
      if (typeof perZar !== 'number' || perZar <= 0) continue;
      items[fiatItemId(code)] = {
        id: fiatItemId(code),
        label: `${code} → ZAR`,
        kind: 'fiat',
        rate: 1 / perZar,
        asOf: data.date,
        available: true,
        error: null,
      };
    }
  } catch (err) {
    // Keep serving the last good rate per pair if we have one — a transient fetch failure
    // shouldn't blank out a number that was fine an hour ago.
    for (const code of FIAT_CODES) {
      const id = fiatItemId(code);
      if (!items[id].available) items[id] = { ...items[id], error: 'Could not fetch exchange rate.' };
    }
    // eslint-disable-next-line no-console
    console.error('[fx] fiat refresh failed:', err);
  } finally {
    clearTimeout(timer);
  }
}

/** BTC/ETH → ZAR via CoinGecko's free public `simple/price` endpoint — no API key, supports ZAR
 * directly as a `vs_currency` so no cross-rate math is needed here either. */
async function refreshCrypto(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const ids = CRYPTO_COINS.map((c) => c.id).join(',');
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=zar&include_last_updated_at=true`,
      { signal: controller.signal },
    );
    if (!res.ok) throw new Error(`coingecko -> ${res.status}`);
    const data = (await res.json()) as Record<string, { zar?: number; last_updated_at?: number }>;
    for (const coin of CRYPTO_COINS) {
      const entry = data[coin.id];
      if (!entry || typeof entry.zar !== 'number') continue;
      items[cryptoItemId(coin.label)] = {
        id: cryptoItemId(coin.label),
        label: `${coin.label} → ZAR`,
        kind: 'crypto',
        rate: entry.zar,
        asOf: entry.last_updated_at ? new Date(entry.last_updated_at * 1000).toISOString() : null,
        available: true,
        error: null,
      };
    }
  } catch (err) {
    for (const coin of CRYPTO_COINS) {
      const id = cryptoItemId(coin.label);
      if (!items[id].available) items[id] = { ...items[id], error: 'Could not fetch price.' };
    }
    // eslint-disable-next-line no-console
    console.error('[fx] crypto refresh failed:', err);
  } finally {
    clearTimeout(timer);
  }
}

let pollerStarted = false;

export function startFxPoller(): void {
  if (pollerStarted) return;
  pollerStarted = true;
  lastRefreshAt = Date.now();
  refreshFiat();
  refreshCrypto();
  setInterval(refreshFiat, FIAT_POLL_MS);
  setInterval(refreshCrypto, CRYPTO_POLL_MS);
}

export function getFxItems(): FxItem[] {
  return Object.values(items);
}

/** The card's manual "refresh" button — re-fetches both fiat and crypto right away instead of
 * waiting for either's own scheduled poll. Within `REFRESH_COOLDOWN_MS` of the last refresh
 * (scheduled or manual), this just returns what's already cached. */
export async function refreshFxNow(): Promise<FxItem[]> {
  if (Date.now() - lastRefreshAt < REFRESH_COOLDOWN_MS) return getFxItems();
  lastRefreshAt = Date.now();
  await Promise.all([refreshFiat(), refreshCrypto()]);
  return getFxItems();
}
