import { useMemo, useState } from 'react';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar date (not UTC) — same convention as `CalendarView`'s `dateKey`/`TodayNote`'s
 * `todayDateString`. Using `toISOString().slice(0, 10)` here would shift the date by one in any
 * timezone west of UTC. */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * A small single-month calendar for picking a start/end date range — used by the sports-events
 * "Multi-day" quick-add flow (StatBar's card, CalendarView's per-day popup) instead of two bare
 * `<input type="date">` fields, so the span being selected is actually visible as you pick it.
 *
 * With `lockStart` (set from CalendarView, where the start is already fixed to whichever day
 * cell's "+" was clicked), the start date can't move — clicking only extends/shortens the end.
 * Without it (StatBar, where nothing is fixed yet), the first click sets the start, the next sets
 * the end if it's later or moves the start if it's earlier, and a third click after a complete
 * range starts a brand new selection — the usual range-picker click pattern.
 */
export function DateRangeModal({
  initialStart,
  initialEnd,
  lockStart = false,
  onApply,
  onClose,
}: {
  initialStart: string;
  initialEnd?: string | null;
  lockStart?: boolean;
  onApply: (start: string, end: string) => void;
  onClose: () => void;
}) {
  const [rangeStart, setRangeStart] = useState(initialStart);
  const [rangeEnd, setRangeEnd] = useState<string | null>(initialEnd ?? null);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = parseKey(initialStart);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const days = useMemo(() => {
    const gridStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1 - viewMonth.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * DAY_MS));
  }, [viewMonth]);

  const handleClick = (key: string) => {
    if (lockStart) {
      if (key <= rangeStart) return;
      setRangeEnd(key);
      return;
    }
    if (rangeEnd !== null) {
      setRangeStart(key);
      setRangeEnd(null);
      return;
    }
    if (key === rangeStart) return;
    if (key > rangeStart) setRangeEnd(key);
    else setRangeStart(key);
  };

  const todayKey = dateKey(new Date());
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg font-semibold text-slate-100">Pick the date range</h2>
        <p className="mb-4 text-xs text-slate-500">
          {lockStart ? 'Click the day this event ends on.' : 'Click the start day, then the end day.'}
        </p>

        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
            className="rounded px-2 py-1 text-sm text-slate-400 hover:text-violet-300"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-slate-200">{monthLabel}</span>
          <button
            onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
            className="rounded px-2 py-1 text-sm text-slate-400 hover:text-violet-300"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="py-1 text-center text-[10px] font-medium uppercase text-slate-500">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const key = dateKey(day);
            const outsideMonth = day.getMonth() !== viewMonth.getMonth();
            const isStart = key === rangeStart;
            const isEnd = rangeEnd !== null && key === rangeEnd;
            const inRange = rangeEnd !== null && key > rangeStart && key < rangeEnd;
            const isToday = key === todayKey;
            const disabled = lockStart && key < rangeStart;
            return (
              <button
                key={key}
                disabled={disabled}
                onClick={() => handleClick(key)}
                className={`rounded py-1.5 text-xs transition ${outsideMonth ? 'text-slate-600' : 'text-slate-200'} ${
                  isStart || isEnd
                    ? 'bg-violet-600 font-semibold text-white'
                    : inRange
                      ? 'bg-violet-500/20 text-violet-200'
                      : disabled
                        ? 'opacity-30'
                        : 'hover:bg-slate-800'
                } ${isToday && !isStart && !isEnd ? 'ring-1 ring-inset ring-violet-500/50' : ''}`}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {rangeEnd ? `${rangeStart} → ${rangeEnd}` : 'Pick an end day…'}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
            <button
              onClick={() => rangeEnd && onApply(rangeStart, rangeEnd)}
              disabled={!rangeEnd}
              className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
