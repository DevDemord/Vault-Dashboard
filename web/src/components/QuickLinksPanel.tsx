import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { QuickLink } from '../types';

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** `crypto.randomUUID` only exists in secure contexts (HTTPS/localhost) — this dashboard is plain HTTP on a Tailscale IP. */
function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Google's `client=SOCIAL` endpoint resolves more sites than anything else (it's what makes
 * `s2/favicons?domain=` work at all — that wrapper always builds an internal `http://` lookup URL
 * server-side, which 404s for sites indexed only under `https://`, e.g. web.whatsapp.com; passing
 * the real page URL with scheme fixes that) — but it wraps the result in a white circle "badge"
 * rather than returning the site's plain mark, so it's kept as a last-resort fallback, not first.
 */
function googleFaviconV2Src(url: string): string {
  return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url)}&size=64`;
}

function googleFaviconSrc(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
}

function duckduckgoFaviconSrc(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}

/** Naive apex-domain guess (last two labels) — favicon lookups often 404 on a subdomain (e.g. `web.whatsapp.com`) but have the icon for its apex (`whatsapp.com`). */
function apexGuess(domain: string): string | null {
  const parts = domain.split('.');
  if (parts.length <= 2) return null;
  return parts.slice(-2).join('.');
}

/**
 * Several independent ways to resolve a favicon, tried in order — any one source (a blocked
 * tracker domain, an un-indexed subdomain) can fail without taking down the rest. The site's own
 * favicon and DuckDuckGo's lookup come first since both return the plain mark; Google's endpoints
 * are kept as later fallbacks since they resolve more sites but add a white circle badge.
 */
function faviconCandidates(url: string): string[] {
  const domain = hostnameOf(url);
  const apex = apexGuess(domain);
  const candidates: string[] = [];
  try {
    const { protocol } = new URL(url);
    candidates.push(`${protocol}//${domain}/favicon.ico`);
  } catch {
    // ignore
  }
  candidates.push(duckduckgoFaviconSrc(domain), googleFaviconV2Src(url), googleFaviconSrc(domain));
  if (apex && apex !== domain) {
    candidates.push(duckduckgoFaviconSrc(apex), googleFaviconSrc(apex));
  }
  return candidates;
}

/** Resizes/crops an uploaded image to a square PNG data URL, small enough for the settings record. */
function fileToIconDataUrl(file: File, size = 64): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable'));
          return;
        }
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function LinkIcon({ url, icon }: { url: string; icon?: string }) {
  const domain = hostnameOf(url);
  const candidates = useMemo(() => (icon ? [] : faviconCandidates(url)), [url, icon]);
  const [index, setIndex] = useState(0);

  if (icon) {
    return <img src={icon} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg" />;
  }

  if (index >= candidates.length) {
    return (
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800 text-sm font-medium text-slate-400">
        {domain.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      key={candidates[index]}
      src={candidates[index]}
      alt=""
      className="h-8 w-8 flex-shrink-0 rounded-lg"
      onError={() => setIndex((i) => i + 1)}
    />
  );
}

export function QuickLinksPanel() {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Loaded once from the server on mount — intentionally NOT re-synced via a `useEffect` watching
  // `links`/`collapsed`, since that would fire with the `[]`/`false` defaults before this fetch
  // resolves and could race a real PATCH into clobbering server state with empties. Every write
  // below instead calls `api.updateSettings` explicitly, right where the local state changes.
  useEffect(() => {
    api
      .getSettings()
      .then((settings) => {
        setLinks(settings.quickLinks);
        setCollapsed(settings.quickLinksCollapsed);
      })
      .catch(() => {
        // keep defaults — the rest of the dashboard still works without quick links
      });
  }, []);

  const updateCollapsed = (value: boolean) => {
    setCollapsed(value);
    api.updateSettings({ quickLinksCollapsed: value }).catch(() => {
      // local state already updated; a failed save just means it won't persist this time
    });
  };

  const persistLinks = (next: QuickLink[]) => {
    setLinks(next);
    api.updateSettings({ quickLinks: next }).catch(() => {
      // local state already updated; a failed save just means it won't persist this time
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setLabel('');
    setUrl('');
    setIcon(null);
    setIconError(null);
    setFormOpen(false);
  };

  const toggleAddForm = () => {
    if (formOpen && editingId === null) {
      resetForm();
      return;
    }
    setEditingId(null);
    setLabel('');
    setUrl('');
    setIcon(null);
    setIconError(null);
    setFormOpen(true);
  };

  const openEditForm = (link: QuickLink) => {
    setEditingId(link.id);
    setLabel(link.label);
    setUrl(link.url);
    setIcon(link.icon ?? null);
    setIconError(null);
    setFormOpen(true);
  };

  const expandAndOpenAdd = () => {
    updateCollapsed(false);
    toggleAddForm();
  };

  const expandAndEdit = () => {
    updateCollapsed(false);
    setEditMode(true);
  };

  const handleIconFile = async (file: File) => {
    setIconError(null);
    try {
      setIcon(await fileToIconDataUrl(file));
    } catch {
      setIconError('Could not read that image.');
    }
  };

  const saveLink = () => {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    const next = editingId
      ? links.map((l) =>
          l.id === editingId ? { ...l, label: label.trim(), url: normalized, icon: icon ?? undefined } : l,
        )
      : [...links, { id: makeId(), label: label.trim(), url: normalized, icon: icon ?? undefined }];
    persistLinks(next);
    resetForm();
  };

  const removeLink = (id: string) => {
    persistLinks(links.filter((l) => l.id !== id));
    if (editingId === id) resetForm();
  };

  if (collapsed) {
    return (
      <div className="flex h-full w-14 flex-col items-center gap-1.5 py-3">
        <button
          onClick={() => updateCollapsed(false)}
          title="Show quick links"
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
        >
          ⟨⟨
        </button>
        <div className="my-1 h-px w-8 bg-slate-800" />
        <div className="scroll-pane flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
          {links.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title={link.label || hostnameOf(link.url)}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg transition hover:bg-slate-800/60"
            >
              <LinkIcon url={link.url} icon={link.icon} />
            </a>
          ))}
        </div>
        <div className="my-1 h-px w-8 bg-slate-800" />
        <button
          onClick={expandAndEdit}
          title="Edit links"
          className="flex h-9 w-9 items-center justify-center rounded-full text-sm text-slate-300 transition hover:bg-slate-800/60 hover:text-slate-200"
        >
          ✎
        </button>
        <button
          onClick={expandAndOpenAdd}
          title="Add link"
          className="flex h-9 w-9 items-center justify-center rounded-full text-sm text-slate-300 transition hover:bg-slate-800/60 hover:text-slate-200"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-44 flex-col">
      <div className="flex items-center justify-between border-b border-slate-800/80 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Quick links</div>
        <button
          onClick={() => updateCollapsed(true)}
          title="Collapse"
          className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-800/60 hover:text-slate-200"
        >
          ⟩⟩
        </button>
      </div>

      <div className="scroll-pane min-h-0 flex-1 overflow-y-auto p-3">
      {formOpen && (
        <div className="mb-3 space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
          <div className="text-xs font-medium text-slate-300">{editingId ? 'Edit link' : 'New link'}</div>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveLink()}
            placeholder="URL, e.g. mtg.thewatchtower.co.za"
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-2">
            {icon ? (
              <img src={icon} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg border border-slate-700" />
            ) : (
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-700 text-slate-600">
                ?
              </span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleIconFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-violet-500/50 hover:text-violet-200"
            >
              Upload icon
            </button>
            {icon && (
              <button
                type="button"
                onClick={() => setIcon(null)}
                className="text-xs text-slate-500 hover:text-red-400"
              >
                Clear
              </button>
            )}
          </div>
          {!icon && <div className="text-[11px] text-slate-500">Leave blank to auto-detect the site's favicon.</div>}
          {iconError && <div className="text-xs text-red-300">{iconError}</div>}

          <div className="flex items-center justify-end gap-2">
            {editingId && (
              <button
                onClick={() => removeLink(editingId)}
                className="mr-auto px-2 py-1 text-xs text-red-400/80 hover:text-red-300"
              >
                Delete
              </button>
            )}
            <button onClick={resetForm} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">
              Cancel
            </button>
            <button
              onClick={saveLink}
              className="rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500"
            >
              {editingId ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {links.length === 0 && !formOpen && (
        <div className="px-1 py-2 text-sm text-slate-500">No links yet — add one with the + above.</div>
      )}

      <div className="grid grid-cols-2 justify-items-center gap-1">
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target={editMode ? undefined : '_blank'}
            rel="noopener noreferrer"
            title={editMode ? 'Click to edit' : link.label || hostnameOf(link.url)}
            onClick={(e) => {
              if (editMode) {
                e.preventDefault();
                openEditForm(link);
              }
            }}
            className="group relative flex h-12 w-12 items-center justify-center rounded-lg border border-transparent transition-all hover:border-violet-500/50 hover:shadow-[0_0_12px_rgba(167,139,250,0.4)]"
          >
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                removeLink(link.id);
              }}
              title="Remove"
              className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-[10px] text-slate-400 transition-opacity hover:bg-red-500/80 hover:text-white ${
                editMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              ✕
            </button>
            <LinkIcon url={link.url} icon={link.icon} />
            {editMode && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-slate-950/50 text-sm text-slate-200 opacity-0 transition-opacity group-hover:opacity-100">
                ✎
              </span>
            )}
          </a>
        ))}
      </div>
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-slate-800/80 p-2">
        <button
          onClick={() => setEditMode((v) => !v)}
          title={editMode ? 'Done editing' : 'Edit links'}
          className={`flex h-7 w-7 items-center justify-center rounded-full text-sm transition ${
            editMode
              ? 'bg-violet-500/30 text-violet-200'
              : 'bg-slate-800/80 text-slate-300 hover:bg-violet-500/30 hover:text-violet-200'
          }`}
        >
          ✎
        </button>
        <button
          onClick={toggleAddForm}
          title="Add link"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800/80 text-sm text-slate-300 transition hover:bg-violet-500/30 hover:text-violet-200"
        >
          +
        </button>
      </div>
    </div>
  );
}
