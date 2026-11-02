import { useMemo, useState } from 'react';
import { api } from '../api';
import { hexToRgb } from './calloutTypes';
import { DateRangeModal } from './DateRangeModal';
import { sportColor } from './sportColors';
import type { SportsEvent } from '../types';

const SPORTS_EVENTS_NOTE = '_Templates/sports-events.md';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS_SHOWN = 4;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local calendar date (not UTC) — same convention as `TodayNote`'s `todayDateString`. Using
 * `toISOString().slice(0, 10)` here would shift the date by one in any timezone west of UTC. */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

/**
 * A rolling 4-week grid (Sun–Sat columns) showing upcoming sports events on the day they fall,
 * so "how do the next few weeks look" is a glance instead of reading a flat list. Scoped to
 * sports events for now (the only dated content the vault tracks) — daily notes or task due
 * dates could layer onto the same grid later if wanted.
 */
export function CalendarView({
  items,
  sportColors,
  onNavigate,
  onChanged,
}: {
  items: SportsEvent[];
  /** `Settings.sportColors` — per-tag overrides; see `sportColors.ts` for the fallback chain. */
  sportColors: Record<string, string>;
  onNavigate: (relPath: string) => void;
  /** Called after successfully adding an event from the grid, so the caller can refresh its own
   * copy of the list (this component doesn't own that state — it's handed down as `items`). */
  onChanged: () => void;
}) {
  const [pageOffset, setPageOffset] = useState(0);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState('');
  const [addTime, setAddTime] = useState('');
  const [addSport, setAddSport] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayKey = dateKey(new Date());

  const days = useMemo(() => {
    const start = startOfWeek(new Date());
    start.setDate(start.getDate() + pageOffset * 7 * WEEKS_SHOWN);
    return Array.from({ length: WEEKS_SHOWN * 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  }, [pageOffset]);

  // Each day in a multi-day event's [date, endDate] range gets its own entry in this map, so a
  // weekend-long F1 race shows up on Friday, Saturday, *and* Sunday's cell, not just its start day.
  const eventsByDate = useMemo(() => {
    const map = new Map<string, SportsEvent[]>();
    for (const e of items) {
      let cursor = new Date(`${e.date}T00:00:00`);
      const last = new Date(`${e.endDate ?? e.date}T00:00:00`);
      while (cursor.getTime() <= last.getTime()) {
        const key = dateKey(cursor);
        const list = map.get(key) ?? [];
        list.push(e);
        map.set(key, list);
        cursor = new Date(cursor.getTime() + DAY_MS);
      }
    }
    for (const list of map.values()) list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
    return map;
  }, [items]);

  const [addEndDate, setAddEndDate] = useState('');
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const addMultiDay = Boolean(addEndDate);

  const openAdd = (key: string) => {
    setAddingKey(key);
    setAddTitle('');
    setAddTime('');
    setAddEndDate('');
    setAddSport('');
    setError(null);
  };

  const submitAdd = async (key: string) => {
    const title = addTitle.trim();
    if (!title || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.addSportsEvent(title, key, addTime.trim() || null, addMultiDay ? addEndDate : null, addSport.trim() || null);
      setAddingKey(null);
      onChanged();
    } catch {
      setError('Could not save that event.');
    } finally {
      setSaving(false);
    }
  };

  const rangeLabel = `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[
    days.length - 1
  ].toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-semibold text-slate-100">📅 Calendar</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPageOffset((v) => v - 1)}
            className="rounded-lg border border-slate-800 px-2.5 py-1 text-sm text-slate-300 transition hover:border-violet-500/40 hover:text-violet-300"
          >
            ‹ Prev
          </button>
          <button
            onClick={() => setPageOffset(0)}
            disabled={pageOffset === 0}
            className="rounded-lg border border-slate-800 px-2.5 py-1 text-sm text-slate-300 transition hover:border-violet-500/40 hover:text-violet-300 disabled:opacity-40"
          >
            Today
          </button>
          <button
            onClick={() => setPageOffset((v) => v + 1)}
            className="rounded-lg border border-slate-800 px-2.5 py-1 text-sm text-slate-300 transition hover:border-violet-500/40 hover:text-violet-300"
          >
            Next ›
          </button>
        </div>
      </div>
      <div className="mb-3 text-sm text-slate-500">{rangeLabel}</div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-800/80 bg-slate-800/80">
        {WEEKDAY_LABELS.map((d) => (
          <div
            key={d}
            className="bg-slate-900/70 px-2 py-1.5 text-center text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            {d}
          </div>
        ))}

        {days.map((day) => {
          const key = dateKey(day);
          const dayEvents = eventsByDate.get(key) ?? [];
          const isToday = key === todayKey;
          const isAdding = addingKey === key;
          return (
            <div
              key={key}
              className={`group relative min-h-[6.5rem] bg-slate-900/40 p-1.5 ${
                isToday ? 'ring-1 ring-inset ring-violet-500/50' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs ${isToday ? 'font-semibold text-violet-300' : 'text-slate-500'}`}>
                  {day.getDate()}
                </span>
                {!isAdding && (
                  <button
                    onClick={() => openAdd(key)}
                    title="Add an event"
                    className="flex-shrink-0 rounded px-1 text-xs text-slate-600 opacity-0 transition hover:text-violet-300 group-hover:opacity-100"
                  >
                    +
                  </button>
                )}
              </div>

              <div className="mt-1 flex flex-col gap-1">
                {dayEvents.map((e) => {
                  // A tagged sport (`#f1`, `#cs2`, …) gets its own color regardless of span length;
                  // an untagged event falls back to the old violet/amber single-day/multi-day split.
                  const rgb = e.sport ? hexToRgb(sportColor(sportColors, e.sport)) : null;
                  const fallbackAmber = !rgb && e.endDate;
                  return (
                    <button
                      key={`${e.date}-${e.line}`}
                      onClick={() => onNavigate(SPORTS_EVENTS_NOTE)}
                      title={e.endDate ? `${e.title} (${e.date} – ${e.endDate})` : e.title}
                      style={
                        rgb
                          ? { backgroundColor: `rgba(${rgb},0.18)`, color: `rgb(${rgb})` }
                          : undefined
                      }
                      className={`truncate rounded px-1.5 py-0.5 text-left text-xs transition hover:brightness-125 ${
                        rgb
                          ? ''
                          : fallbackAmber
                            ? 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                            : 'bg-violet-500/15 text-violet-200 hover:bg-violet-500/25'
                      }`}
                    >
                      {e.time && key === e.date && (
                        <span
                          style={rgb ? { color: `rgb(${rgb})` } : undefined}
                          className={rgb ? '' : fallbackAmber ? 'text-amber-400' : 'text-violet-400'}
                        >
                          {e.time}{' '}
                        </span>
                      )}
                      {e.title}
                    </button>
                  );
                })}
              </div>

              {isAdding && (
                <div className="absolute inset-x-1 top-6 z-10 flex flex-col gap-1 rounded-lg border border-slate-700 bg-slate-950 p-1.5 shadow-xl">
                  <input
                    autoFocus
                    value={addTitle}
                    onChange={(e) => setAddTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitAdd(key)}
                    placeholder="Event title…"
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
                  />
                  <input
                    type="time"
                    value={addTime}
                    onChange={(e) => setAddTime(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-100 focus:border-violet-500 focus:outline-none"
                  />
                  <input
                    value={addSport}
                    onChange={(e) => setAddSport(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitAdd(key)}
                    placeholder="Sport tag (f1, cs2, rugby…)"
                    className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
                  />
                  {addMultiDay ? (
                    <button
                      onClick={() => setRangeModalOpen(true)}
                      className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-300 hover:border-violet-500/50"
                    >
                      <span>📅 → {addEndDate}</span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setAddEndDate('');
                        }}
                        title="Make this a single-day event"
                        className="text-slate-500 hover:text-red-300"
                      >
                        ✕
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setRangeModalOpen(true)}
                      className="text-left text-xs text-slate-500 hover:text-violet-300"
                    >
                      + Multi-day
                    </button>
                  )}
                  <div className="flex gap-1">
                    <button
                      onClick={() => void submitAdd(key)}
                      disabled={saving || !addTitle.trim() || (addMultiDay && !addEndDate)}
                      className="flex-1 rounded bg-violet-600 px-1.5 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      {saving ? '…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setAddingKey(null)}
                      className="rounded px-1.5 py-1 text-xs text-slate-400 hover:text-slate-200"
                    >
                      ✕
                    </button>
                  </div>
                  {error && <div className="text-xs text-red-300">{error}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rangeModalOpen && addingKey && (
        <DateRangeModal
          initialStart={addingKey}
          initialEnd={addEndDate || null}
          lockStart
          onClose={() => setRangeModalOpen(false)}
          onApply={(_start, end) => {
            setAddEndDate(end);
            setRangeModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
