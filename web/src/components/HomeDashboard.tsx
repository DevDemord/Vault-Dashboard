import type { NoteSummary, Stats } from '../types';
import { StatBar } from './StatBar';
import { TodayNote } from './TodayNote';
import { UnreadMailWidget } from './UnreadMailWidget';

/**
 * The dashboard's actual home-screen body (stat row + today's note / recently-edited / mail
 * widgets) — shared between the top-level home view and a split pane's non-note side, so both
 * land on the same real home screen instead of a cut-down picker.
 */
export function HomeDashboard({
  stats,
  notes,
  statColors,
  sportColors,
  sportImages,
  onViewActivity,
  onViewMail,
  onViewSports,
  onSportsEventAdded,
  activeTag,
  visibleNotes,
  recentNotes,
  loadError,
  onNavigateNote,
  onOpenLink,
  onTodayNoteSaved,
  homeMode,
}: {
  stats: Stats | null;
  notes: NoteSummary[];
  statColors: Record<string, string>;
  sportColors: Record<string, string>;
  sportImages: Record<string, string>;
  onViewActivity: () => void;
  onViewMail: () => void;
  onViewSports: () => void;
  onSportsEventAdded: () => void;
  activeTag: string | null;
  visibleNotes: NoteSummary[];
  recentNotes: NoteSummary[];
  loadError: string | null;
  onNavigateNote: (relPath: string) => void;
  /** Clicking a `[[wikilink]]` inside Today's Note always opens it as a split pane on the
   * right, keeping Today's Note itself visible — there's no "replace what I'm looking at"
   * option that would make sense for a persistent home-page widget. */
  onOpenLink?: (relPath: string) => void;
  onTodayNoteSaved: () => void;
  /** 'work' drops the mail column below — no inline message previews on a screen a
   * colleague might see. The top toolbar's unread-count pill is unaffected either way. */
  homeMode: 'personal' | 'work';
}) {
  return (
    <div className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <div className="hidden md:block lg:flex-shrink-0">
        {stats && (
          <StatBar
            stats={stats}
            notes={notes}
            colors={statColors}
            sportColors={sportColors}
            sportImages={sportImages}
            onViewActivity={onViewActivity}
            onViewMail={onViewMail}
            onViewSports={onViewSports}
            onSportsEventAdded={onSportsEventAdded}
            homeMode={homeMode}
          />
        )}
      </div>

      <div
        className={`grid grid-cols-1 gap-6 md:mt-8 lg:min-h-0 lg:flex-1 lg:auto-rows-fr ${
          homeMode === 'work'
            ? 'lg:grid-cols-[minmax(0,80fr)_minmax(0,20fr)]'
            : 'lg:grid-cols-[minmax(0,70fr)_minmax(0,15fr)_minmax(0,15fr)]'
        }`}
      >
        <div className="lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col">
          <TodayNote onSaved={onTodayNoteSaved} notes={notes} onOpenLink={onOpenLink} />
        </div>

        <div className="lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col">
          <div className="mb-2 flex-shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">
            {activeTag ? `Tagged #${activeTag} (${visibleNotes.length})` : 'Recently edited'}
          </div>
          <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800/80 bg-slate-900/40 shadow-sm shadow-black/20 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {(activeTag ? visibleNotes : recentNotes).map((note) => (
              <button
                key={note.relPath}
                onClick={() => onNavigateNote(note.relPath)}
                className="group block w-full border-l-2 border-transparent px-3 py-2.5 text-left transition-all hover:border-violet-500 hover:bg-slate-800/50"
              >
                <div className="truncate text-sm font-medium text-slate-100 transition-colors group-hover:text-violet-200">
                  {note.title}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {note.folder || '(root)'} · {note.excerpt}
                </div>
              </button>
            ))}
            {(activeTag ? visibleNotes.length === 0 : recentNotes.length === 0) && !loadError && (
              <div className="px-3 py-4 text-sm text-slate-500">
                {activeTag ? `No notes tagged #${activeTag}.` : 'No notes found in the vault yet.'}
              </div>
            )}
          </div>
        </div>

        {homeMode !== 'work' && <UnreadMailWidget onOpenMail={onViewMail} />}
      </div>
    </div>
  );
}
