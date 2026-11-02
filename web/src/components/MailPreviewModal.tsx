import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../api';
import type { MailMessageBody } from '../types';

// Registered once at module load — forces every link in a previewed email to open in a new tab
// rather than navigating inside the sandboxed iframe (which `sandbox="allow-popups"` below allows
// precisely so this works) and strips any `window.opener` access from the new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

/**
 * Preview modal opened by clicking a message row on the mail page. Fetches the full parsed body
 * on demand (never cached/polled, unlike the unread list) and renders it inside a sandboxed,
 * scriptless iframe rather than a plain `dangerouslySetInnerHTML` div — two separate reasons:
 * (1) email HTML is attacker-controlled content from the open internet, so DOMPurify sanitizes it
 * first, but an iframe sandbox is the real backstop in case of any sanitizer bypass; (2) even
 * fully sanitized, a `<style>` block inside the email isn't scoped to a plain div — browsers
 * apply it document-wide regardless of DOM nesting, so it would otherwise bleed into (and could
 * break) the rest of the dashboard. `sandbox="allow-popups"` alone — no `allow-scripts`, no
 * `allow-same-origin` — blocks all script execution and keeps the iframe's origin opaque, while
 * still letting a `target="_blank"` link (forced via the hook above) open in a new tab. The
 * tradeoff: without `allow-same-origin` there's no way to read the iframe's content height from
 * here, so it gets a fixed height with its own internal scrollbar instead of auto-sizing.
 *
 * Opening this modal also marks the message read — `onMarkRead` fires once the body has
 * actually loaded successfully (not on a failed fetch, since the user never saw anything), using
 * whichever parent-owned mark-read function is already wired up to that parent's own account
 * state (full Mail page or the home-page widget) rather than this modal keeping its own copy.
 */
export function MailPreviewModal({
  address,
  uid,
  onClose,
  onMarkRead,
}: {
  address: string;
  uid: number;
  onClose: () => void;
  onMarkRead?: (address: string, uid: number) => void;
}) {
  const [body, setBody] = useState<MailMessageBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBody(null);
    setError(null);
    api
      .mailMessageBody(address, uid)
      .then((res) => {
        if (cancelled) return;
        if ('error' in res) {
          setError(res.error);
        } else {
          setBody(res);
          onMarkRead?.(address, uid);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this message.');
      });
    return () => {
      cancelled = true;
    };
    // Only re-fetch (and re-mark-read) when the message itself changes, not when the parent
    // re-renders with a new onMarkRead closure identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, uid]);

  const sanitizedHtml = body?.html ? DOMPurify.sanitize(body.html) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 border-b border-slate-800 p-4">
          {error && <div className="text-sm text-red-300">Couldn't load this message: {error}</div>}
          {!body && !error && <div className="text-sm text-slate-500">Loading…</div>}
          {body && (
            <>
              <h2 className="mb-1 truncate font-display text-lg font-semibold text-slate-100">{body.subject}</h2>
              <div className="space-y-0.5 text-xs text-slate-500">
                <div className="truncate">From: {body.from}</div>
                {body.to && <div className="truncate">To: {body.to}</div>}
                {body.date && <div>{formatDate(body.date)}</div>}
              </div>
            </>
          )}
        </div>

        {body && (
          <div className="min-h-0 flex-1 overflow-hidden bg-white">
            {sanitizedHtml ? (
              <iframe
                title={body.subject}
                sandbox="allow-popups"
                srcDoc={sanitizedHtml}
                className="h-[60vh] w-full"
              />
            ) : (
              <pre className="h-[60vh] overflow-y-auto whitespace-pre-wrap bg-slate-900 p-4 text-sm text-slate-300">
                {body.text || '(no content)'}
              </pre>
            )}
          </div>
        )}

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-800 p-3">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
