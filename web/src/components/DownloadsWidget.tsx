import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { DownloadPreviewModal } from './DownloadPreviewModal';
import type { DownloadSummary } from '../types';

/** Downloads rarely take long (most are short clips), and a user who just pasted a link wants to
 * see it land reasonably soon — shorter than the Mail widget's 60s poll, which is for a mailbox
 * that doesn't need second-by-second freshness. */
const POLL_MS = 15_000;
const SHOWN_LIMIT = 8;

function StatusDot({ status }: { status: string }) {
  if (status === 'downloading') {
    return <span className="inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-amber-400" />;
  }
  if (status === 'failed') {
    return <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-red-400" />;
  }
  return <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />;
}

/**
 * Home-page widget for a separate, optional downloads dashboard (a downloader for Instagram/
 * TikTok/YouTube/Pinterest links you may already be self-hosting elsewhere) — a glance at what's
 * recently been downloaded, plus a way to queue a new link, without leaving the Vault home page.
 * The actual download/playback/playlist management stays on that dashboard itself (reached via
 * "Open dashboard →"); this is deliberately just "what's new" + "add one", same scope as the
 * Unread Mail widget beside it. All calls go through this app's own server
 * (`server/src/downloads.ts`), which proxies to the other dashboard — that app's API has no CORS
 * headers, so a direct browser-side fetch from this origin would just be blocked.
 */
export function DownloadsWidget({ defaultVolume }: { defaultVolume: number }) {
  const [items, setItems] = useState<DownloadSummary[] | null>(null);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<DownloadSummary | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const load = () => {
      api
        .downloads(SHOWN_LIMIT)
        .then((res) => {
          if (!mountedRef.current) return;
          if ('error' in res) {
            setError(res.error);
          } else {
            setError(null);
            setItems(res.items);
            setDashboardUrl(res.dashboardUrl);
          }
        })
        .catch(() => {
          if (mountedRef.current) setError('Could not reach the downloads dashboard.');
        });
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.addDownload(trimmed);
      if (!result.ok) {
        setSubmitError(result.error ?? 'Could not queue that link.');
        return;
      }
      setUrl('');
      // The add call only resolves once the download itself is done (or a playlist's been
      // queued) — refresh right away rather than waiting for the next poll tick.
      const res = await api.downloads(SHOWN_LIMIT);
      if (!('error' in res)) {
        setItems(res.items);
        setDashboardUrl(res.dashboardUrl);
      }
    } catch {
      setSubmitError('Could not reach the downloads dashboard.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>⬇ Downloads</span>
        {dashboardUrl && (
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="font-normal normal-case text-slate-500 hover:text-violet-300"
          >
            Open dashboard →
          </a>
        )}
      </div>

      <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-3 shadow-sm shadow-black/20">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="mb-3 flex gap-2"
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste an Instagram / TikTok / YouTube / Pinterest link…"
            className="flex-1 rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={submitting || !url.trim()}
            title="This waits for the download to finish, which can take a little while"
            className="flex-shrink-0 rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {submitting ? 'Downloading…' : 'Download'}
          </button>
        </form>
        {submitError && <div className="mb-3 text-sm text-red-300">{submitError}</div>}

        {error && <div className="text-sm text-slate-500">Downloads dashboard unavailable — {error}</div>}
        {!error && !items && <div className="text-sm text-slate-500">Loading…</div>}
        {!error && items?.length === 0 && <div className="text-sm text-slate-500">Nothing downloaded yet.</div>}

        {!error && items && items.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {items.map((item) => {
              const content = (
                <>
                  <div className="relative flex h-20 w-32 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-950">
                    {item.thumbUrl ? (
                      <img src={item.thumbUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-2xl text-slate-700">🎬</span>
                    )}
                  </div>
                  <div className="mt-1 flex w-32 items-start gap-1">
                    <StatusDot status={item.status} />
                    <div className="min-w-0 truncate text-xs text-slate-400" title={item.errorMessage ?? item.title ?? undefined}>
                      {item.title ?? item.url}
                    </div>
                  </div>
                </>
              );
              return (
                <button key={item.id} onClick={() => setPreviewItem(item)} className="group text-left">
                  {content}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {previewItem && (
        <DownloadPreviewModal
          item={previewItem}
          defaultVolume={defaultVolume}
          onClose={() => setPreviewItem(null)}
          onDeleted={(id) => setItems((prev) => prev?.filter((i) => i.id !== id) ?? prev)}
        />
      )}
    </div>
  );
}
