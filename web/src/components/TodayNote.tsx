import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { MarkdownEditor } from './MarkdownEditor';
import { splitHeaderBody } from './noteSplit';
import type { NoteDetail, NoteSummary } from '../types';

/** Local calendar date (not UTC) — "today" should follow the user's own clock. Exported so
 * other "jump to today's note" entry points (the DockNav quick-action) use the exact same
 * date this widget's own autosave/load already keys off of. */
export function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 1200;

/**
 * Always-editing, autosaving quick-capture box pinned to the top of the home dashboard — today's
 * daily note (`6. Daily/YYYY-MM-DD.md`), created on first visit each day via `POST /api/daily`.
 * Unlike the full note editor (manual Save button, uncontrolled `MarkdownEditor`), this wires up
 * `MarkdownEditor`'s `onChange` and debounce-saves ~1.2s after you stop typing, so there's nothing
 * to click — the whole point is zero friction between having a thought and it being on disk.
 */
export function TodayNote({
  onSaved,
  notes,
  onOpenLink,
}: {
  onSaved?: (note: NoteDetail) => void;
  notes?: NoteSummary[];
  onOpenLink?: (relPath: string) => void;
}) {
  const [relPath, setRelPath] = useState<string | null>(null);
  const [initialValue, setInitialValue] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<string>('');
  const latestBody = useRef<string>('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const date = todayDateString();
    api
      .getOrCreateDaily(date)
      .then((note) => {
        if (!mountedRef.current) return;
        setRelPath(note.relPath);
        return api.getRaw(note.relPath).then((content) => {
          if (!mountedRef.current) return;
          const { header, body } = splitHeaderBody(content);
          headerRef.current = header;
          latestBody.current = body;
          setInitialValue(body);
        });
      })
      .catch(() => {
        if (mountedRef.current) setError("Could not load today's note.");
      });

    return () => {
      mountedRef.current = false;
      // Flush rather than drop: a pending debounce timer means unsaved keystrokes, and the
      // component unmounting (navigating away) is no reason to lose them.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (relPath) void api.updateRaw(relPath, headerRef.current + latestBody.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSave = async () => {
    if (!relPath) return;
    setSaveState('saving');
    try {
      const updated = await api.updateRaw(relPath, headerRef.current + latestBody.current);
      if (mountedRef.current) setSaveState('saved');
      onSaved?.(updated);
    } catch (err) {
      if (mountedRef.current) {
        setSaveState('error');
        setError(err instanceof ApiError ? err.message : "Could not save today's note.");
      }
    }
  };

  const handleChange = (body: string) => {
    latestBody.current = body;
    setSaveState('dirty');
    setError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void doSave(), AUTOSAVE_DELAY_MS);
  };

  if (error && initialValue === null) {
    return (
      <div className="mb-8 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (initialValue === null) {
    return (
      <div className="mb-8 h-64 min-h-[16rem] animate-pulse rounded-lg border border-slate-800 bg-slate-900/40 lg:mb-0 lg:h-full" />
    );
  }

  return (
    <div className="mb-8 lg:mb-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <div className="mb-2 flex flex-shrink-0 items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">📅 Today — {todayDateString()}</div>
        <div className="text-xs text-slate-500">
          {saveState === 'dirty' && 'Unsaved changes…'}
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'error' && <span className="text-red-400">{error ?? "Couldn't save"}</span>}
        </div>
      </div>
      {/* Fixed h-64 on mobile (where the grid stacks to one column and there's no spare
          viewport to claim). At lg+, App.tsx makes this component's own cell in the home grid
          stretch to the full height of that row (flex column, lg:h-full down the chain) — so
          flex-1/min-h-0 here just claims whatever real space that row turns out to have, rather
          than guessing a vh-minus-chrome pixel number (the previous approach caused the whole
          page to scroll whenever the guess overshot the actual remaining space). Still a
          bounded, scrollable box either way — it sits beside Recently Edited in a grid row
          rather than being the page's only content, so it shouldn't grow unbounded with the
          day's note length. */}
      <MarkdownEditor
        key={relPath}
        initialValue={initialValue}
        onChange={handleChange}
        notes={notes}
        onOpenLink={onOpenLink}
        className="h-64 overflow-y-auto rounded-lg border border-slate-800 lg:h-auto lg:min-h-0 lg:flex-1"
      />
    </div>
  );
}
