/**
 * Thin server-side proxy to a separate, optional "downloads dashboard" (a general Instagram/
 * TikTok/YouTube/Pinterest downloader) you may already be self-hosting elsewhere on your
 * network. Proxied through this server rather than fetched directly from the browser for the
 * same reason the Gmail integration lives server-side: that dashboard's API has no CORS
 * headers, so a browser-side fetch from this app's own origin would just be blocked outright.
 * Server-to-server HTTP has no such restriction. Set `IG_DASHBOARD_URL` to wherever yours lives;
 * leave it unset and the widget just won't find anything to show.
 */

const IG_DASHBOARD_URL = process.env.IG_DASHBOARD_URL ?? 'http://localhost:3011';

export interface DownloadSummary {
  id: string;
  url: string;
  status: string;
  title: string | null;
  author: string | null;
  thumbUrl: string | null;
  mediaUrl: string | null;
  /** Null when there's no media yet (still downloading, or failed before producing anything) —
   * otherwise which player the preview modal should show. Comes from the first entry in that
   * dashboard's own `mediaJson` array. */
  mediaType: 'video' | 'image' | 'audio' | null;
  errorMessage: string | null;
  createdAt: string;
}

interface RawDownloadRow {
  id: string;
  url: string;
  status: string;
  title: string | null;
  author: string | null;
  filePath: string | null;
  thumbFile: string | null;
  mediaJson: string | null;
  errorMessage: string | null;
  createdAt: string;
}

function toSummary(row: RawDownloadRow): DownloadSummary {
  let mediaFile = row.filePath;
  let thumbFile = row.thumbFile;
  let mediaType: DownloadSummary['mediaType'] = null;
  // Older/edge-case rows can have the per-media-file details only in `mediaJson` (a JSON array —
  // see that dashboard's own `MediaFile` type) and not mirrored onto the row's own columns; fall
  // back to the first entry there rather than showing no thumbnail/file at all.
  if (row.mediaJson) {
    try {
      const media = JSON.parse(row.mediaJson) as Array<{ file?: string; thumb?: string | null; type?: string }>;
      mediaFile = mediaFile ?? media[0]?.file ?? null;
      thumbFile = thumbFile ?? media[0]?.thumb ?? null;
      const rawType = media[0]?.type;
      mediaType = rawType === 'video' || rawType === 'image' || rawType === 'audio' ? rawType : null;
    } catch {
      // leave whatever we already had
    }
  }
  return {
    id: row.id,
    url: row.url,
    status: row.status,
    title: row.title,
    author: row.author,
    thumbUrl: thumbFile ? `${IG_DASHBOARD_URL}/media/${encodeURIComponent(thumbFile)}` : null,
    mediaUrl: mediaFile ? `${IG_DASHBOARD_URL}/media/${encodeURIComponent(mediaFile)}` : null,
    mediaType,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  };
}

export async function listRecentDownloads(
  limit: number,
): Promise<{ items: DownloadSummary[]; dashboardUrl: string } | { error: string }> {
  try {
    const res = await fetch(`${IG_DASHBOARD_URL}/api/downloads`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { error: `Downloads dashboard returned ${res.status}` };
    const rows = (await res.json()) as RawDownloadRow[];
    // Already sorted newest-first by that API's own `ORDER BY createdAt DESC`.
    return { items: rows.slice(0, limit).map(toSummary), dashboardUrl: IG_DASHBOARD_URL };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not reach the downloads dashboard' };
  }
}

/** Queues a new download. For a single video/reel this blocks until yt-dlp actually finishes —
 * that's the real behavior of the IG dashboard's own `POST /api/download` (its own UI has the
 * exact same wait), not an extra delay this proxy adds — so this can legitimately take anywhere
 * from a few seconds to over a minute. A playlist URL is the one case that *doesn't* block (that
 * endpoint queues it and returns immediately), handled by the same request/timeout either way. */
export async function queueDownload(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${IG_DASHBOARD_URL}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(180_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? `Downloads dashboard returned ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reach the downloads dashboard' };
  }
}

/** Removes a download's log entry — mirrors that dashboard's own `DELETE /api/downloads/:id`
 * exactly, including its one deliberate limitation: only the database row goes away, the actual
 * media file on disk never gets touched by this call. Not this app's decision to revisit — it's
 * the other dashboard's own documented behavior, kept as-is here. */
export async function deleteDownload(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${IG_DASHBOARD_URL}/api/downloads/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `Downloads dashboard returned ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reach the downloads dashboard' };
  }
}
