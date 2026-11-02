const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 200_000; // plenty for a <title> tag, caps memory/time on huge pages

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#?\w+);/g, (match, name) => ENTITY_MAP[name] ?? match);
}

/**
 * Best-effort `<title>` fetch for "paste a URL, get a readable link" — reads only up to
 * `MAX_BYTES` of the response (title tags are always in the `<head>`, so there's never a reason
 * to download the whole page) and gives up cleanly on anything that isn't a normal HTML page.
 */
export async function fetchLinkTitle(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; VaultDashboard/1.0)' },
    });
    if (!res.ok || !res.body) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let received = 0;
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (/<\/title>/i.test(html)) break;
    }
    void reader.cancel().catch(() => {});

    const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    if (!match) return null;
    const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim();
    return title || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
