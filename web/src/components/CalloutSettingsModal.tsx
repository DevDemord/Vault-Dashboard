import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { TrendingSource } from '../types';
import { AttachmentPickerModal } from './AttachmentPickerModal';
import {
  groupCalloutTypesByIcon,
  rgbToHex,
  IMAGE_ICON_PREFIX,
  CALLOUT_TYPE_OPTIONS,
  DEFAULT_CALLOUT_STYLE,
  type CalloutIconGroup,
} from './calloutTypes';
import { sportColor } from './sportColors';
import { DEFAULT_STAT_COLORS, STAT_COLOR_KEYS, STAT_COLOR_LABELS, statColor } from './statColors';

const DEFAULT_HEX = rgbToHex(DEFAULT_CALLOUT_STYLE.rgb);

/** The icon box (text, uploaded image, or one picked from `_Attachments`), upload/browse buttons,
 * and color swatch shared by both a built-in group's row and a custom callout's row — the only
 * difference between them is what happens on "reset" (back to a real default vs. just clearing to
 * the generic fallback). */
function IconColorInputs({
  icon,
  color,
  uploading,
  existingImages,
  onIconChange,
  onUpload,
  onColorChange,
}: {
  icon: string;
  color: string;
  uploading: boolean;
  existingImages: { relPath: string; size: number }[];
  onIconChange: (icon: string) => void;
  onUpload: (file: File | undefined) => void;
  onColorChange: (color: string) => void;
}) {
  const [browseOpen, setBrowseOpen] = useState(false);
  const isImage = icon.startsWith(IMAGE_ICON_PREFIX);
  return (
    <>
      {isImage ? (
        <img
          src={`/api/attachments/${encodeURIComponent(icon.slice(IMAGE_ICON_PREFIX.length))}`}
          alt=""
          className="h-8 w-8 flex-shrink-0 rounded object-contain"
        />
      ) : (
        <input
          value={icon}
          onChange={(e) => onIconChange(e.target.value)}
          maxLength={8}
          className="w-11 flex-shrink-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-center text-base focus:border-violet-500 focus:outline-none"
        />
      )}

      <label
        title="Upload a new image to use instead of an emoji"
        className="flex-shrink-0 cursor-pointer rounded border border-slate-700 px-1.5 py-1.5 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
      >
        {uploading ? '…' : '⬆'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            onUpload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>

      <button
        onClick={() => setBrowseOpen(true)}
        title="Use an image already in _Attachments"
        disabled={existingImages.length === 0}
        className="flex-shrink-0 rounded border border-slate-700 px-1.5 py-1.5 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300 disabled:opacity-30"
      >
        🖼
      </button>
      {browseOpen && (
        <AttachmentPickerModal
          files={existingImages}
          onClose={() => setBrowseOpen(false)}
          onSelect={(relPath) => {
            onIconChange(`${IMAGE_ICON_PREFIX}${relPath}`);
            setBrowseOpen(false);
          }}
        />
      )}

      <input
        type="color"
        value={color}
        onChange={(e) => onColorChange(e.target.value)}
        title="Callout color"
        className="h-8 w-8 flex-shrink-0 cursor-pointer rounded border border-slate-700 bg-transparent p-0"
      />
    </>
  );
}

/** Upload/browse/clear controls for a sport tag's background image — just the image half of a
 * tag row (the color swatch next to it is a plain `<input type="color">`, not worth sharing with
 * this). No emoji fallback like `IconColorInputs` has, since this is always an image or nothing. */
function SportImageInput({
  imageRelPath,
  uploading,
  existingImages,
  onChange,
  onUpload,
}: {
  imageRelPath: string | null;
  uploading: boolean;
  existingImages: { relPath: string; size: number }[];
  onChange: (relPath: string | null) => void;
  onUpload: (file: File | undefined) => void;
}) {
  const [browseOpen, setBrowseOpen] = useState(false);
  return (
    <>
      {imageRelPath ? (
        <img
          src={`/api/attachments/${encodeURIComponent(imageRelPath)}`}
          alt=""
          className="h-8 w-8 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-8 w-8 flex-shrink-0 rounded border border-dashed border-slate-700" />
      )}

      <label
        title="Upload a background image for this sport"
        className="flex-shrink-0 cursor-pointer rounded border border-slate-700 px-1.5 py-1.5 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300"
      >
        {uploading ? '…' : '⬆'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            onUpload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>

      <button
        onClick={() => setBrowseOpen(true)}
        title="Use an image already in _Attachments"
        disabled={existingImages.length === 0}
        className="flex-shrink-0 rounded border border-slate-700 px-1.5 py-1.5 text-xs text-slate-400 hover:border-violet-500/50 hover:text-violet-300 disabled:opacity-30"
      >
        🖼
      </button>
      {browseOpen && (
        <AttachmentPickerModal
          files={existingImages}
          onClose={() => setBrowseOpen(false)}
          onSelect={(relPath) => {
            onChange(relPath);
            setBrowseOpen(false);
          }}
        />
      )}

      {imageRelPath && (
        <button
          onClick={() => onChange(null)}
          title="Remove this sport's background image"
          className="flex-shrink-0 rounded px-1 text-xs text-slate-500 hover:text-red-300"
        >
          ✕
        </button>
      )}
    </>
  );
}

/** Normalizes a user-typed custom type name to what `[!type]` matching actually compares against
 * — remarkObsidianCallouts lowercases the marker, and only letters/digits/underscore/hyphen are
 * even parseable as a callout type at all. */
function normalizeTypeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/** One add-a-keyword input plus the current list as removable chips — shared shape for both the
 * "interested in" and "not interested in" lists below, which differ only in color and what
 * adding/removing actually does server-side. */
function KeywordListEditor({
  keywords,
  placeholder,
  chipClassName,
  onAdd,
  onRemove,
}: {
  keywords: string[];
  placeholder: string;
  chipClassName: string;
  onAdd: (keyword: string) => Promise<void>;
  onRemove: (keyword: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const submit = async () => {
    const value = draft.trim();
    if (!value || adding) return;
    setAdding(true);
    try {
      await onAdd(value);
      setDraft('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={adding || !draft.trim()}
          className="flex-shrink-0 rounded bg-violet-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {keywords.length === 0 ? (
        <p className="text-xs text-slate-500">None yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {keywords.map((kw) => (
            <span key={kw} className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${chipClassName}`}>
              {kw}
              <button
                onClick={() => onRemove(kw)}
                title={`Remove "${kw}"`}
                className="text-current opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Static — these are the three feeds `trending.ts` actually polls server-side, not something a
 * user configures. Listed here so it's visible what's being pulled in and from where. */
const TRENDING_SOURCES = [
  { name: 'Hacker News', detail: 'news.ycombinator.com', icon: '📰', url: 'https://news.ycombinator.com' },
  { name: 'GitHub', detail: 'trending repos', icon: '🐙', url: 'https://github.com/trending' },
  { name: 'Lobsters', detail: 'lobste.rs', icon: '🦞', url: 'https://lobste.rs' },
] as const;

/** The Settings modal's "Feed" section — tunes the home page's Trending card. Unlike every other
 * section in this modal, changes here save immediately (their own dedicated endpoints in
 * `trending.ts`, same ones the card's own "not interested" button and "manage blocked topics"
 * list use) rather than waiting for the big Save button at the bottom — there's no draft state
 * to reconcile with a parent `onSaved` callback, since `trendingBlockedKeywords`/
 * `trendingInterestKeywords` aren't threaded through this modal's other props at all. */
function FeedSettingsPanel() {
  const [blocked, setBlocked] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [sources, setSources] = useState<TrendingSource[]>([]);
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [addingSource, setAddingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  useEffect(() => {
    api.trendingBlocked().then(setBlocked).catch(() => {});
    api.trendingInterests().then(setInterests).catch(() => {});
    api.trendingSources().then(setSources).catch(() => {});
  }, []);

  const addSource = async () => {
    const name = sourceName.trim();
    const url = sourceUrl.trim();
    if (!name || !url || addingSource) return;
    setAddingSource(true);
    setSourceError(null);
    try {
      setSources(await api.trendingAddSource(name, url));
      setSourceName('');
      setSourceUrl('');
    } catch (err) {
      setSourceError(err instanceof ApiError ? err.message : 'Could not add that source.');
    } finally {
      setAddingSource(false);
    }
  };

  const removeSource = (id: string) => {
    api.trendingRemoveSource(id).then(setSources).catch(() => {});
  };

  return (
    <>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Feed</div>
      <p className="mb-4 text-xs text-slate-500">
        Tune the home page's Trending card. Saves immediately — no need to hit Save below.
      </p>

      <div className="mb-5">
        <div className="mb-1 text-sm font-medium text-slate-200">Interested in</div>
        <p className="mb-1.5 text-xs text-slate-500">Items matching these show up more often in the rotation.</p>
        <KeywordListEditor
          keywords={interests}
          placeholder="e.g. Godot, Factorio, homelab…"
          chipClassName="bg-violet-500/15 text-violet-200"
          onAdd={async (kw) => setInterests(await api.trendingAddInterest(kw))}
          onRemove={(kw) => api.trendingRemoveInterest(kw).then(setInterests)}
        />
      </div>

      <div>
        <div className="mb-1 text-sm font-medium text-slate-200">Not interested in</div>
        <p className="mb-1.5 text-xs text-slate-500">
          Items matching these are filtered out entirely — never shown, never logged to a daily note.
          The card's own "✕ not interested" button adds to this same list automatically.
        </p>
        <KeywordListEditor
          keywords={blocked}
          placeholder="e.g. crypto, politics…"
          chipClassName="bg-red-500/15 text-red-200"
          onAdd={async (kw) => setBlocked(await api.trendingBlockKeyword(kw))}
          onRemove={(kw) => api.trendingUnblock(kw).then(setBlocked)}
        />
      </div>

      <div className="mt-5 border-t border-slate-800 pt-3">
        <div className="mb-1 text-sm font-medium text-slate-200">Sources</div>
        <p className="mb-1.5 text-xs text-slate-500">
          Built in, plus any RSS/Atom feed you add below — a tech blog, a subreddit, a newsletter.
          Each source gets its own subsection in the daily note's "Trending feed" log.
        </p>
        <div className="space-y-1">
          {TRENDING_SOURCES.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded border border-slate-800/80 px-2.5 py-1.5 text-sm text-slate-300 hover:border-violet-500/50 hover:text-violet-300"
            >
              <span className="flex-shrink-0">{s.icon}</span>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="flex-shrink-0 text-xs text-slate-500">{s.detail}</span>
            </a>
          ))}
          {sources.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded border border-slate-800/80 px-2.5 py-1.5 text-sm text-slate-300"
            >
              <span className="flex-shrink-0">📡</span>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                title={s.url}
                className="min-w-0 flex-1 truncate hover:text-violet-300"
              >
                {s.name}
              </a>
              <button
                onClick={() => removeSource(s.id)}
                title={`Remove "${s.name}"`}
                className="flex-shrink-0 text-slate-500 hover:text-red-300"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-1.5">
          <input
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSource()}
            placeholder="Name (e.g. TechCrunch)"
            className="w-2/5 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
          />
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSource()}
            placeholder="RSS/Atom feed URL"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
          />
          <button
            onClick={addSource}
            disabled={addingSource || !sourceName.trim() || !sourceUrl.trim()}
            className="flex-shrink-0 rounded bg-violet-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {addingSource ? '…' : 'Add'}
          </button>
        </div>
        {sourceError && <p className="mt-1.5 text-xs text-red-300">{sourceError}</p>}
        <p className="mt-1.5 text-xs text-slate-600">
          Some sites (Reddit among them) block automated requests outright and can't be added this way.
        </p>
      </div>
    </>
  );
}

/**
 * Site icon upload — saves immediately (own endpoint, same "no need to hit Save below" pattern as
 * `FeedSettingsPanel`), stored server-side under `DATA_DIR` rather than the vault's `_Attachments`
 * (it's app chrome, not vault content — it shouldn't show up in the Dead attachments/Explorer
 * views) and never in browser storage, so it follows the user across devices/browsers.
 */
function SiteIconSettingsPanel({
  siteIcon,
  onChange,
}: {
  siteIcon: string | null;
  onChange: (siteIcon: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { siteIcon: next } = await api.uploadSiteIcon(file);
      onChange(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that image.');
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await api.removeSiteIcon();
      onChange(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that icon.');
    }
  };

  return (
    <>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Site icon</div>
      <p className="mb-3 text-xs text-slate-500">
        Replaces the "V" glyph shown when the sidebar is collapsed. Saves immediately — no need to
        hit Save below.
      </p>
      <div className="flex items-center gap-3 rounded-lg border border-slate-800/80 px-2.5 py-2">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-display font-semibold text-white">
          {siteIcon ? (
            <img
              src={`/api/site-icon?v=${encodeURIComponent(siteIcon)}`}
              alt="Current site icon"
              className="h-full w-full object-cover"
            />
          ) : (
            'V'
          )}
        </div>
        <label className="flex-shrink-0 cursor-pointer rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-violet-500/50 hover:text-violet-300">
          {uploading ? 'Uploading…' : siteIcon ? 'Replace…' : 'Upload…'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
        {siteIcon && (
          <button
            onClick={remove}
            title="Remove site icon"
            className="flex-shrink-0 rounded px-2 py-1.5 text-xs text-slate-500 hover:text-red-300"
          >
            ✕ Remove
          </button>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </>
  );
}

/**
 * Lets the user restyle any built-in callout (icon, image, color) and define brand new custom
 * callout types from scratch — the Obsidian Callout Manager-style ask. Built-ins are grouped by
 * icon rather than by raw `[!type]` string (tip/hint/important already render identically, so one
 * row covers all three); custom types have no grouping since each is its own type. Both icon maps
 * are flat `Record<[!type], value>` already, so a custom type is just a key that isn't one of
 * calloutTypes.ts's own — no separate storage needed, which is also how a reopened modal
 * rediscovers previously-added custom types without a dedicated "list of custom types" field.
 */
export function CalloutSettingsModal({
  calloutIcons,
  calloutColors,
  statColors,
  sportColors,
  sportImages,
  knownSportTags,
  videoVolume,
  attachmentFiles,
  siteIcon,
  onSiteIconChange,
  onClose,
  onSaved,
}: {
  calloutIcons: Record<string, string>;
  calloutColors: Record<string, string>;
  statColors: Record<string, string>;
  sportColors: Record<string, string>;
  /** Vault-relative path per sport tag — the home-page card's fading background image. */
  sportImages: Record<string, string>;
  /** Every distinct `#tag` actually used in `_Templates/sports-events.md` right now, so this modal
   * can list real tags to color without the user retyping them — same spirit as grouping callouts
   * by their real `[!type]` names rather than asking the user to remember them. */
  knownSportTags: string[];
  /** Default volume (0–1) a video/audio download preview starts at. */
  videoVolume: number;
  /** Images already sitting in `_Attachments`, so the user can pick one instead of re-uploading
   * a duplicate. */
  attachmentFiles: { relPath: string; size: number }[];
  /** Filename of the currently-uploaded custom site icon (server-stored, not browser storage), or
   * null for the plain "V" glyph. */
  siteIcon: string | null;
  /** Called the moment an upload/remove actually persists server-side — unlike the rest of this
   * modal's fields, there's no "Save" step for this one, so the collapsed sidebar rail picks up
   * the change immediately. */
  onSiteIconChange: (siteIcon: string | null) => void;
  onClose: () => void;
  onSaved: (
    calloutIcons: Record<string, string>,
    calloutColors: Record<string, string>,
    statColors: Record<string, string>,
    sportColors: Record<string, string>,
    sportImages: Record<string, string>,
    videoVolume: number,
  ) => void;
}) {
  const groups = groupCalloutTypesByIcon();
  const [draftIcon, setDraftIcon] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, calloutIcons[g.id] ?? g.defaultIcon])),
  );
  const [draftColor, setDraftColor] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, calloutColors[g.id] ?? rgbToHex(g.defaultRgb)])),
  );

  const existingCustomTypes = [...new Set([...Object.keys(calloutIcons), ...Object.keys(calloutColors)])].filter(
    (t) => !CALLOUT_TYPE_OPTIONS.includes(t),
  );
  const [customTypes, setCustomTypes] = useState<string[]>(existingCustomTypes);
  const [customIcon, setCustomIcon] = useState<Record<string, string>>(() =>
    Object.fromEntries(existingCustomTypes.map((t) => [t, calloutIcons[t] ?? DEFAULT_CALLOUT_STYLE.icon])),
  );
  const [customColor, setCustomColor] = useState<Record<string, string>>(() =>
    Object.fromEntries(existingCustomTypes.map((t) => [t, calloutColors[t] ?? DEFAULT_HEX])),
  );
  const [newTypeName, setNewTypeName] = useState('');

  const [draftStatColors, setDraftStatColors] = useState<Record<string, string>>(() =>
    Object.fromEntries(STAT_COLOR_KEYS.map((key) => [key, statColor(statColors, key)])),
  );

  const [sportTags, setSportTags] = useState<string[]>(() => [
    ...new Set([...knownSportTags, ...Object.keys(sportColors), ...Object.keys(sportImages)]),
  ]);
  const [draftSportColors, setDraftSportColors] = useState<Record<string, string>>(() =>
    Object.fromEntries(sportTags.map((tag) => [tag, sportColor(sportColors, tag)])),
  );
  const [draftSportImages, setDraftSportImages] = useState<Record<string, string>>(() => ({ ...sportImages }));
  const [newSportTagName, setNewSportTagName] = useState('');

  const addSportTag = () => {
    const name = normalizeTypeName(newSportTagName);
    if (!name || sportTags.includes(name)) return;
    setSportTags((t) => [...t, name]);
    setDraftSportColors((d) => ({ ...d, [name]: sportColor(sportColors, name) }));
    setNewSportTagName('');
  };

  const removeSportTag = (tag: string) => {
    setSportTags((t) => t.filter((x) => x !== tag));
  };

  const uploadSportImage = async (tag: string, file: File | undefined) => {
    if (!file) return;
    const key = `sport:${tag}`;
    setUploading((u) => ({ ...u, [key]: true }));
    setError(null);
    try {
      const { relPath } = await api.uploadAttachment(file);
      setDraftSportImages((d) => ({ ...d, [tag]: relPath }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that image.');
    } finally {
      setUploading((u) => ({ ...u, [key]: false }));
    }
  };

  const [draftVideoVolume, setDraftVideoVolume] = useState(videoVolume);

  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const SECTIONS = [
    { id: 'general', label: 'General' },
    { id: 'callouts', label: 'Callout styles' },
    { id: 'stats', label: 'Stat card colors' },
    { id: 'feed', label: 'Feed' },
    { id: 'sports', label: 'Sport colors' },
    { id: 'playback', label: 'Playback' },
  ] as const;
  type SectionId = (typeof SECTIONS)[number]['id'];
  const [activeSection, setActiveSection] = useState<SectionId>('callouts');

  const isGroupDefault = (group: CalloutIconGroup) =>
    draftIcon[group.id] === group.defaultIcon && draftColor[group.id] === rgbToHex(group.defaultRgb);

  const resetGroup = (group: CalloutIconGroup) => {
    setDraftIcon((d) => ({ ...d, [group.id]: group.defaultIcon }));
    setDraftColor((d) => ({ ...d, [group.id]: rgbToHex(group.defaultRgb) }));
  };

  const upload = async (key: string, file: File | undefined, setIcon: (icon: string) => void) => {
    if (!file) return;
    setUploading((u) => ({ ...u, [key]: true }));
    setError(null);
    try {
      const { relPath } = await api.uploadAttachment(file);
      setIcon(`${IMAGE_ICON_PREFIX}${relPath}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that image.');
    } finally {
      setUploading((u) => ({ ...u, [key]: false }));
    }
  };

  const handleAddCustomType = () => {
    const name = normalizeTypeName(newTypeName);
    if (!name) return;
    if (CALLOUT_TYPE_OPTIONS.includes(name) || customTypes.includes(name)) {
      setError(`"${name}" already exists — pick a different name.`);
      return;
    }
    setCustomTypes((t) => [...t, name]);
    setCustomIcon((d) => ({ ...d, [name]: DEFAULT_CALLOUT_STYLE.icon }));
    setCustomColor((d) => ({ ...d, [name]: DEFAULT_HEX }));
    setNewTypeName('');
    setError(null);
  };

  const removeCustomType = (name: string) => {
    setCustomTypes((t) => t.filter((x) => x !== name));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const nextIcons: Record<string, string> = {};
    const nextColors: Record<string, string> = {};
    for (const group of groups) {
      const icon = draftIcon[group.id];
      if (icon && icon !== group.defaultIcon) {
        for (const alias of group.aliases) nextIcons[alias] = icon;
      }
      const color = draftColor[group.id];
      if (color && color.toLowerCase() !== rgbToHex(group.defaultRgb).toLowerCase()) {
        for (const alias of group.aliases) nextColors[alias] = color;
      }
    }
    for (const name of customTypes) {
      if (customIcon[name]) nextIcons[name] = customIcon[name];
      if (customColor[name]) nextColors[name] = customColor[name];
    }
    const nextStatColors: Record<string, string> = {};
    for (const key of STAT_COLOR_KEYS) {
      const color = draftStatColors[key];
      if (color && color.toLowerCase() !== DEFAULT_STAT_COLORS[key].toLowerCase()) {
        nextStatColors[key] = color;
      }
    }
    const nextSportColors: Record<string, string> = {};
    for (const tag of sportTags) {
      const color = draftSportColors[tag];
      // Compare against what this tag would render as with *no* override at all (built-in or
      // hashed fallback) — same "only store what differs from the computed default" rule as
      // statColors above, just against a dynamic default instead of a fixed one.
      if (color && color.toLowerCase() !== sportColor({}, tag).toLowerCase()) {
        nextSportColors[tag] = color;
      }
    }
    const nextSportImages: Record<string, string> = {};
    for (const tag of sportTags) {
      if (draftSportImages[tag]) nextSportImages[tag] = draftSportImages[tag];
    }
    try {
      const saved = await api.updateSettings({
        calloutIcons: nextIcons,
        calloutColors: nextColors,
        statColors: nextStatColors,
        sportColors: nextSportColors,
        sportImages: nextSportImages,
        videoVolume: draftVideoVolume,
      });
      // Belt-and-suspenders: trust what the server actually wrote back, not just that the
      // request didn't throw — a mismatch here means something silently failed to persist,
      // which should surface as an error instead of the modal closing like nothing's wrong.
      const badIcon = Object.entries(nextIcons).find(([k, v]) => saved.calloutIcons[k] !== v);
      const badColor = Object.entries(nextColors).find(([k, v]) => saved.calloutColors[k] !== v);
      const badStatColor = Object.entries(nextStatColors).find(([k, v]) => saved.statColors[k] !== v);
      const badSportColor = Object.entries(nextSportColors).find(([k, v]) => saved.sportColors[k] !== v);
      const badSportImage = Object.entries(nextSportImages).find(([k, v]) => saved.sportImages[k] !== v);
      if (
        badIcon ||
        badColor ||
        badStatColor ||
        badSportColor ||
        badSportImage ||
        saved.videoVolume !== draftVideoVolume
      ) {
        setError(
          `"${(badIcon ?? badColor ?? badStatColor ?? badSportColor ?? badSportImage)?.[0] ?? 'video volume'}" didn't save correctly — try again.`,
        );
        return;
      }
      onSaved(nextIcons, nextColors, nextStatColors, nextSportColors, nextSportImages, draftVideoVolume);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="flex h-[80vh] max-h-[640px] w-full max-w-3xl overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-44 flex-shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950/40 p-3">
          <h2 className="mb-3 px-1 font-display text-lg font-semibold text-slate-100">Settings</h2>
          <nav className="space-y-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`block w-full rounded px-2.5 py-1.5 text-left text-sm transition-colors ${
                  activeSection === s.id
                    ? 'bg-violet-600/20 text-violet-200'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="scroll-pane min-h-0 flex-1 overflow-y-auto p-5">
            {activeSection === 'callouts' && (
              <>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Callout styles</div>
                <p className="mb-4 text-xs text-slate-500">
                  Override the icon (emoji or uploaded image) and color for any callout, or add a brand
                  new custom type below. Leave a built-in row as-is to keep its default.
                </p>

                <div className="space-y-1.5">
                  {groups.map((group) => (
                    <div key={group.id} className="flex items-center gap-2 rounded-lg border border-slate-800/80 px-2.5 py-1.5">
                      <IconColorInputs
                        icon={draftIcon[group.id] ?? group.defaultIcon}
                        color={draftColor[group.id] ?? rgbToHex(group.defaultRgb)}
                        uploading={uploading[group.id] ?? false}
                        existingImages={attachmentFiles}
                        onIconChange={(icon) => setDraftIcon((d) => ({ ...d, [group.id]: icon }))}
                        onUpload={(file) => void upload(group.id, file, (icon) => setDraftIcon((d) => ({ ...d, [group.id]: icon })))}
                        onColorChange={(color) => setDraftColor((d) => ({ ...d, [group.id]: color }))}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{group.aliases.join(' / ')}</span>
                      {!isGroupDefault(group) && (
                        <button
                          onClick={() => resetGroup(group)}
                          title="Reset to default"
                          className="flex-shrink-0 rounded px-1.5 py-1 text-xs text-slate-500 hover:text-violet-300"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t border-slate-800 pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Custom callouts</span>
                    {customTypes.length > 0 && (
                      <span className="text-[11px] text-slate-600">Type [!name] in a note to use one</span>
                    )}
                  </div>

                  {customTypes.length > 0 && (
                    <div className="mb-2 max-h-[22vh] space-y-1.5 overflow-y-auto pr-1">
                      {customTypes.map((name) => (
                        <div key={name} className="flex items-center gap-2 rounded-lg border border-slate-800/80 px-2.5 py-1.5">
                          <IconColorInputs
                            icon={customIcon[name] ?? DEFAULT_CALLOUT_STYLE.icon}
                            color={customColor[name] ?? DEFAULT_HEX}
                            uploading={uploading[name] ?? false}
                            existingImages={attachmentFiles}
                            onIconChange={(icon) => setCustomIcon((d) => ({ ...d, [name]: icon }))}
                            onUpload={(file) => void upload(name, file, (icon) => setCustomIcon((d) => ({ ...d, [name]: icon })))}
                            onColorChange={(color) => setCustomColor((d) => ({ ...d, [name]: color }))}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-300">[!{name}]</span>
                          <button
                            onClick={() => removeCustomType(name)}
                            title="Remove this custom callout"
                            className="flex-shrink-0 rounded px-1.5 py-1 text-xs text-slate-500 hover:text-red-300"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddCustomType()}
                      placeholder="new-type-name"
                      className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
                    />
                    <button
                      onClick={handleAddCustomType}
                      className="flex-shrink-0 rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-violet-500/50 hover:text-violet-300"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeSection === 'general' && (
              <SiteIconSettingsPanel siteIcon={siteIcon} onChange={onSiteIconChange} />
            )}

            {activeSection === 'stats' && (
              <>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Stat card colors</div>
                <p className="mb-2 text-xs text-slate-500">The home page's Trending / Exchange rate / Last edited / Activity bar.</p>
                <div className="space-y-1.5">
                  {STAT_COLOR_KEYS.map((key) => (
                    <div key={key} className="flex items-center gap-2 rounded-lg border border-slate-800/80 px-2.5 py-1.5">
                      <input
                        type="color"
                        value={draftStatColors[key] ?? DEFAULT_STAT_COLORS[key]}
                        onChange={(e) => setDraftStatColors((d) => ({ ...d, [key]: e.target.value }))}
                        title={`${STAT_COLOR_LABELS[key]} color`}
                        className="h-8 w-8 flex-shrink-0 cursor-pointer rounded border border-slate-700 bg-transparent p-0"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{STAT_COLOR_LABELS[key]}</span>
                      {draftStatColors[key]?.toLowerCase() !== DEFAULT_STAT_COLORS[key].toLowerCase() && (
                        <button
                          onClick={() => setDraftStatColors((d) => ({ ...d, [key]: DEFAULT_STAT_COLORS[key] }))}
                          title="Reset to default"
                          className="flex-shrink-0 rounded px-1.5 py-1 text-xs text-slate-500 hover:text-violet-300"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeSection === 'feed' && <FeedSettingsPanel />}

            {activeSection === 'sports' && (
              <>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Sport colors</div>
                <p className="mb-2 text-xs text-slate-500">
                  Tag a sports event with <code className="text-slate-400">#f1</code>,{' '}
                  <code className="text-slate-400">#cs2</code>, <code className="text-slate-400">#rugby</code>, etc. to
                  color its Calendar pill. Add an image too and it fades in from the right edge of the
                  home-page card when that sport's event is next up. Untagged sports already have a
                  color here — override one below, or add a tag that hasn't been used yet.
                </p>

                {sportTags.length > 0 && (
                  <div className="mb-2 max-h-[22vh] space-y-1.5 overflow-y-auto pr-1">
                    {sportTags.map((tag) => (
                      <div key={tag} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800/80 px-2.5 py-1.5">
                        <input
                          type="color"
                          value={draftSportColors[tag] ?? sportColor(sportColors, tag)}
                          onChange={(e) => setDraftSportColors((d) => ({ ...d, [tag]: e.target.value }))}
                          title={`#${tag} color`}
                          className="h-8 w-8 flex-shrink-0 cursor-pointer rounded border border-slate-700 bg-transparent p-0"
                        />
                        <SportImageInput
                          imageRelPath={draftSportImages[tag] ?? null}
                          uploading={uploading[`sport:${tag}`] ?? false}
                          existingImages={attachmentFiles}
                          onChange={(relPath) =>
                            setDraftSportImages((d) => {
                              if (relPath) return { ...d, [tag]: relPath };
                              const next = { ...d };
                              delete next[tag];
                              return next;
                            })
                          }
                          onUpload={(file) => void uploadSportImage(tag, file)}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-300">#{tag}</span>
                        {draftSportColors[tag]?.toLowerCase() !== sportColor({}, tag).toLowerCase() && (
                          <button
                            onClick={() => setDraftSportColors((d) => ({ ...d, [tag]: sportColor({}, tag) }))}
                            title="Reset to default"
                            className="flex-shrink-0 rounded px-1.5 py-1 text-xs text-slate-500 hover:text-violet-300"
                          >
                            ↺
                          </button>
                        )}
                        <button
                          onClick={() => removeSportTag(tag)}
                          title="Remove this tag's color override"
                          className="flex-shrink-0 rounded px-1.5 py-1 text-xs text-slate-500 hover:text-red-300"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    value={newSportTagName}
                    onChange={(e) => setNewSportTagName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addSportTag()}
                    placeholder="new-tag-name"
                    className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
                  />
                  <button
                    onClick={addSportTag}
                    className="flex-shrink-0 rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-violet-500/50 hover:text-violet-300"
                  >
                    + Add
                  </button>
                </div>
              </>
            )}

            {activeSection === 'playback' && (
              <>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Playback</div>
                <p className="mb-2 text-xs text-slate-500">
                  Default volume a downloaded video/audio preview starts at — drag its own player's volume
                  slider to adjust a specific one while watching, without changing this default.
                </p>
                <div className="flex items-center gap-3 rounded-lg border border-slate-800/80 px-2.5 py-1.5">
                  <span className="flex-shrink-0 text-sm text-slate-400">🔈</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(draftVideoVolume * 100)}
                    onChange={(e) => setDraftVideoVolume(Number(e.target.value) / 100)}
                    className="flex-1 accent-violet-500"
                  />
                  <span className="w-10 flex-shrink-0 text-right text-sm text-slate-300">
                    {Math.round(draftVideoVolume * 100)}%
                  </span>
                  {draftVideoVolume !== 1 && (
                    <button
                      onClick={() => setDraftVideoVolume(1)}
                      title="Reset to default"
                      className="flex-shrink-0 rounded px-1.5 py-1 text-xs text-slate-500 hover:text-violet-300"
                    >
                      ↺
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {error && (
            <div className="mx-5 mb-2 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-800 p-3">
            <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
