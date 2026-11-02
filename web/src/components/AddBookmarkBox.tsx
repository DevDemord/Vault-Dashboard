import { useState } from 'react';

/** A small input next to the Quick search box — paste a URL, hit Enter, it's saved as a new
 * `- [ ] <url>` line in `_Templates/bookmarks-general.md` (the same file the Bookmarks view
 * already scans). `onAdd` is expected to throw on failure so the typed URL isn't lost and the
 * checkmark doesn't flash on an error the caller already toasted. */
export function AddBookmarkBox({ onAdd }: { onAdd: (url: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const submit = async () => {
    const url = value.trim();
    if (!url || saving) return;
    setSaving(true);
    try {
      await onAdd(url);
      setValue('');
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } catch {
      // caller already surfaced an error toast — leave the typed URL in place to retry/fix
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hidden w-56 flex-shrink-0 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 lg:flex">
      <span className="flex-shrink-0 text-slate-500">🔖</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Paste a URL to bookmark…"
        className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
      />
      {saving ? (
        <span className="flex-shrink-0 text-xs text-slate-500">…</span>
      ) : justSaved ? (
        <span className="flex-shrink-0 text-xs text-emerald-400">✓</span>
      ) : (
        value && (
          <button onClick={submit} title="Save bookmark" className="flex-shrink-0 text-slate-500 hover:text-violet-300">
            ↵
          </button>
        )
      )}
    </div>
  );
}
