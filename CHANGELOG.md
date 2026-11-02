# Changelog

All notable changes to the Vault dashboard, newest first. Each deploy to
`/opt/obsidian-dashboard` gets an entry here.

## 2026-11-02 (12)

- **The exchange-rate card's "as of" line moved to the bottom of the card**, out of the
  center column between the ‹ › arrows — the rate value now has that row to itself.
- **Fixed: refreshing the page while reading or editing a note sent you back to the home
  dashboard.** This app has no router, so the current note was never reflected in the URL —
  a plain reload (or just clicking the browser's own refresh button) always restarted at
  `{ kind: 'home' }` with nothing to say otherwise. `App.tsx` now mirrors the current note (and
  whether it's open for editing) into the URL's `?note=`/`&edit=1` query params as you navigate,
  and reads them back on load — via `history.replaceState`, so it doesn't add extra Back-button
  entries or interfere with the existing "Back always goes home" handling.

## 2026-11-02 (11)

- **Daily notes no longer count toward "Last edited" or "Recently edited."** Unlike the two
  `_Templates` files excluded earlier today, this isn't about automation — a daily note really
  is something you wrote — but it's a running scratchpad touched so often over the course of a
  day that it would otherwise permanently dominate both the stat card and the home column over
  whatever note you actually meant to work on. `getStats()` (`vault.ts`) and `recentNotes`
  (`App.tsx`) both now additionally skip anything under `6. Daily`.

## 2026-11-02 (10)

- **Fixed: the home page's "Recently edited" column, not the "Last edited" stat card.** This
  was a genuinely different bug from the last two entries — the list was unexpectedly scoped to
  only notes under `4. Resources`, a filter with no explanation left behind, so any note edited
  outside that one folder (Inbox included) never showed up there at all, no matter how recent.
  That's why editing an Inbox note kept showing an old `4. Resources` note instead — it wasn't
  stale data, it was being filtered out entirely. `App.tsx`'s `recentNotes` is now vault-wide
  (still newest-first, top 8), minus the same two auto-written files `getStats()` already
  excludes.

## 2026-11-02 (9)

- **Fixed: stats (including "Last edited") going stale in an already-open tab.** The
  previous entry's fix was correct — `/api/stats` was already returning the right note — but a
  tab left open never re-asked unless something *inside that tab* happened to trigger a
  refresh. A note edited elsewhere (another device syncing in a change, or the dashboard open in
  a second tab) had no way to reach an idle tab at all, so it looked stuck no matter how
  obviously stale it was. `App.tsx` now re-polls everything `refresh()` covers (notes, tags,
  stats, tasks, bookmarks, etc.) every 60s, the same way the Mail/Sports widgets already
  self-poll, instead of only right after an in-tab save.

## 2026-11-02 (8)

- **Fixed: "Last edited" getting stuck on an auto-written file instead of tracking your own
  edits.** The stat is computed as "whichever note has the newest mtime" — which, since this
  morning's changes, now includes `_Templates/trending-feed.md` (touched every few minutes by
  the Trending poller, with nothing to do with anything you did) and
  `_Templates/claude-activity-log.md`. Either one being more recently touched than your actual
  last edit made the card show that instead, which looked like it had stopped tracking your
  edits at all. `VaultIndex.getStats()` now excludes both from the "last edited" calculation
  (new `STATS_EXCLUDED_FILES` set in `vault.ts`) — note/tag/folder counts are unaffected, only
  which note gets picked as "last edited."

## 2026-11-02 (7)

- **Fixed: note headings didn't look visibly different from body text.** `h4` resolved to
  `text-base` and `h5`/`h6` to `text-sm` in the rendered note view (`.prose-note` in
  `index.css`) — the exact same size as (or smaller than) a plain paragraph, so a note using
  those levels showed no visible heading at all beyond slightly bolder weight. Same underlying
  problem in the editor's live-preview (`liveMarkdownPreview.ts`'s `.cm-heading-*` theme rules),
  where h5/h6 were within a few percent of the 14px body size. Bumped the whole scale up
  (h1–h4 now clearly larger than body in both places) and gave h5/h6 — which have nowhere
  smaller than body text left to shrink to — an uppercase, letter-spaced treatment instead of
  relying on size alone.

## 2026-11-02 (6)

- **Each stat card's heading is now colored with that card's own accent** instead of a uniform
  muted gray — the same hex already used for the card's corner glow (e.g. violet for Trending,
  cyan for the exchange rate, amber for Mail). Previously every heading looked identical except
  for that faint glow, so there was nothing to visually tell cards apart at a glance.

## 2026-11-02 (5)

- **Restyled the home-page stat cards: heading pinned to the top, contents centered, arrows
  moved to the card's sides.** `Segment` (the shared card shell) now stacks vertically and
  centers everything by default, instead of the old single horizontal row. On Trending and the
  exchange-rate card specifically, the ‹ › step arrows now flank the centered item on either
  side (rather than sitting inline next to the badge/refresh button up top), and the
  secondary action (✕ not interested / ⟳ refresh / the sports card's +) moved to a small
  floating button in the card's top-right corner so the heading reads as just the heading.
  Mail's address/count rows are left as a left-right split on purpose — centering a two-column
  list like that would make it harder to scan, not easier — everything else (Last edited,
  Activity's heatmap, Next sports event's display state) is now centered.

## 2026-11-02 (4)

- **Manual ‹ › arrows on the Trending and exchange-rate cards.** Both already auto-rotated on a
  timer (paused on hover); now you can also step through items yourself without waiting. On
  Trending, they sit either side of the source badge; on the exchange-rate card, they sit next
  to the new refresh button. Hidden when there's only one (or zero) items to cycle through.

## 2026-11-02 (3)

- **The exchange-rate card now rotates through 5 pairs and has a manual refresh button.**
  Previously a single, static EUR → ZAR number refreshed hourly. Now it cycles (pause on hover,
  same as Trending) through EUR/USD/GBP → ZAR (still hourly, via Frankfurter/ECB — one call with
  `from=ZAR` covers all three, then each is inverted back to "ZAR per unit" to match the existing
  display convention) plus BTC/ETH → ZAR (every 2 minutes, via CoinGecko's free `simple/price`
  endpoint, no API key). A new ⟳ button calls `POST /api/fx/refresh` to re-fetch both fiat and
  crypto immediately, with a 5s cooldown so a double-click can't hammer CoinGecko's rate limit.
  `FxStatus` (one object) is replaced by `FxItem[]` (one per pair) in both `fx.ts` and the
  shared types; `GET /api/fx` now returns the array.

## 2026-11-02 (2)

- **Moved the Activity page's "Claude activity log" section to the bottom of the page** (it was
  the first thing shown, right under the heading, before the edit heatmap/folder stats/tag
  cloud — now it's last, after all of those).

## 2026-11-02

- **Moved the Trending card's log off the daily note, into its own `_Templates/trending-feed.md`
  note.** It had been crowding out Today's Note — every genuinely-new item the card ever shows
  was getting appended there, grouped `### <source>` under that day's `## Trending feed`
  heading. Now it's nested `## <date>` → `### <source>` inside a single dedicated note instead,
  with each new day's section inserted at the top so the note stays newest-first. New
  `appendToTrendingFeed`/`getOrCreateNote` in `vault.ts` (replacing the now-unused
  `appendToDaily`/`appendToDailyGrouped`), `toTrendingFeedLine` (renamed from
  `toDailyNoteLine`) in `trending.ts`.
- **Moved the hand-written "Claude activity log" off the daily note too, onto the Activity
  page.** Previously a `## Claude activity log` section I'd manually add to today's daily note
  each time something shipped; now it's a dedicated `_Templates/claude-activity-log.md` note
  (same `## YYYY-MM-DD` + bullets shape, newest date first) that the Activity page reads and
  renders directly, so it's out of Today's Note's way and has a permanent, dated home instead of
  being scattered across however many daily notes happen to mention a change. New
  `extractActivityLogEntries` (`markdown.ts`), `VaultIndex.listActivityLog()`,
  `GET /api/activity-log`. Entries already written into old daily notes before this change stay
  there — nothing's been retroactively migrated, this only changes where new ones go.

## 2026-10-30 (2)

- **Fixed: the uploaded site icon wasn't changing the actual browser-tab favicon.** The
  previous entry's "Site icon" upload correctly saved the image and swapped the collapsed
  sidebar's "V" glyph for it, but `index.html` never had a `<link rel="icon">` at all, so there
  was nothing for the upload to actually control in the browser tab/bookmarks. Added a default
  `/favicon.svg` (a plain gradient "V", matching the in-app glyph) and a `useEffect` in
  `App.tsx` that swaps the `<link id="favicon-link">` to the uploaded icon (or back to the
  default on remove) by replacing the tag outright rather than just mutating its `href` — some
  browsers (Chrome included) don't refetch a favicon on a plain `href` change.

## 2026-10-30

- **Fixed: cursor landing at the start of a link instead of after it.** Both ways the editor
  turns a pasted URL into a real link — pasting a bare URL over selected text (the selection
  becomes the link label) and pasting a bare URL on its own (which fetches the page's `<title>`
  and upgrades the raw URL to `[title](url)` once that resolves) — left CodeMirror to work out
  the new cursor position on its own after the replace, which landed it at the *start* of the
  inserted link rather than the end, so continuing to type required clicking past the link or
  pressing Enter first. Both dispatches in `MarkdownEditor.tsx` now explicitly set the cursor to
  just after the inserted text.
- **Custom site icon.** Settings → General has a new "Site icon" upload — replaces the plain
  "V" glyph shown when the sidebar is collapsed. Stored server-side (`DATA_DIR`, same place as
  `settings.json`), not in browser storage, so it follows you across devices/browsers; also
  deliberately not in the vault's `_Attachments` (it's app chrome, not vault content — it
  shouldn't turn up in the Dead attachments or Explorer views). Uploading replaces and deletes
  the previous file; a "✕ Remove" button clears it back to the plain glyph. New
  `POST /api/site-icon` (multipart upload), `POST /api/site-icon/remove`,
  `GET /api/site-icon` (serves the current one, if any), `saveSiteIcon`/`removeSiteIcon`/
  `resolveSiteIconPath` in `settings.ts`, and a new `Settings.siteIcon` field (filename only,
  null means no custom icon).

## 2026-10-28

- **Custom RSS/Atom sources for the Trending card** — the Feed settings section's "Sources"
  list now has an add form (name + feed URL) below the built-in Hacker News/GitHub/Lobsters
  rows. A new source is validated by actually fetching and parsing it once before it's saved, so
  a dead URL or a site that blocks non-browser requests fails with a clear inline error
  immediately instead of silently sitting dead in the list forever. Polled every 20 minutes,
  same cadence as HN/Lobsters, and resumed automatically on restart. New
  `GET/POST /api/trending/sources`, `POST /api/trending/sources/remove`; `addCustomSource`/
  `removeCustomSource`/`listCustomSources`/`refreshCustomSource` in `trending.ts`, a small
  hand-rolled RSS 2.0/Atom parser (regex-based, no new dependency — matches how the rest of this
  codebase already hand-extracts structured text), and a new `trendingCustomSources` Settings
  field. Reddit's own RSS endpoint, which blocked every non-browser request outright back when
  Lobsters replaced it as a built-in source, actually works fine through this path with the
  same plain, non-spoofed user-agent this app has always sent — apparently that lockout wasn't
  permanent, or wasn't as blanket as it looked at the time.
  - **Every `TrendingItem` now carries an explicit `source` field** ("Hacker News", "GitHub",
    "Lobsters", or a custom source's own name) instead of baking the provider name into the
    `meta` string — the Trending card's existing badge (top-right of the card, e.g. "HN"/"GH")
    now falls back to showing a custom source's real name directly when it isn't one of the
    three hardcoded ones.
  - **The daily note's "Trending feed" log is now grouped per provider** — each source gets its
    own `### <source>` subsection (under the existing `## Trending feed` heading) instead of one
    flat list interleaving every source by recency, so it's clear at a glance what came from
    where. New `VaultIndex.appendToDailyGrouped()` in `vault.ts`, alongside (not replacing) the
    existing flat `appendToDaily()`. Entries logged before this change keep their old flat
    format — only new entries land in the new grouped structure.

## 2026-10-27 (7)

- **Added a "paste a URL to bookmark it" box next to Quick search** — type or paste a URL,
  press Enter, and it's appended as a new `- [ ] <url>` line to
  `_Templates/bookmarks-general.md` (the same file the Bookmarks view already scans for bare-URL
  checkboxes), grouped under a `## YYYY-MM-DD` heading for today. No new storage or bookmarks
  model needed — it just writes exactly the kind of line the existing Bookmarks/Tasks scanner
  already recognizes as a bookmark rather than a task. New `POST /api/bookmarks` endpoint
  (`vault.addBookmark()`), rejects anything that isn't a plausible `http(s)://` URL.

## 2026-10-27 (6)

- **Fixed: clicking onto a new line to resume editing could open its wikilink instead of
  placing the cursor there.** The editor's click handler only treated a line as "active" (plain
  click places cursor, Ctrl/Cmd+click opens) if the cursor was *already* sitting on it before
  the click — so clicking a different line that happened to contain a `[[wikilink]]` was always
  treated as "inactive" and opened it, even though the click's real intent was just to move the
  cursor there and keep typing. Now a plain click in the editor never opens a link, period — it
  always just places the cursor — and Ctrl/Cmd+click opens, consistently, everywhere in the
  editor. This also fixes every link's "Ctrl+Click to open" tooltip, which used to be wrong half
  the time (plain click actually worked on inactive lines, contradicting its own tooltip).
  Matches real Obsidian's own live-preview click behavior.

## 2026-10-27 (5)

- **Added a "Sources" list to the Feed settings section**, below the keyword lists — a static,
  clickable rundown of exactly what the Trending card actually polls: Hacker News
  (news.ycombinator.com), GitHub (trending repos), and Lobsters (lobste.rs). Informational only,
  not user-editable — these are the real sources `trending.ts` fetches from server-side, listed
  so it's visible at a glance what's feeding the card.

## 2026-10-27 (4)

- **Added a "Feed" section to the Settings modal** for tuning the Trending card without waiting
  to see an item on it first: an "Interested in" list and a "Not interested in" list, each a
  type-and-add input plus removable chips. Both save immediately (their own dedicated endpoints,
  same ones the card itself uses) rather than going through the modal's usual big Save button.
  - **"Interested in"** keywords *boost* matching items — `getTrendingFeed()` now duplicates any
    item matching an interest keyword into the merged rotation (case-insensitive substring on
    title+meta), so it shows up roughly twice as often instead of just once per cycle. A plain
    reorder wouldn't actually change frequency over a full rotation, only timing, which is why
    duplication was needed instead.
  - **"Not interested in"** is the same list the card's own "✕ not interested" button writes to
    — now also directly editable here, so a topic can be pre-blocked before ever seeing it, not
    just reactively after.
  - New `Settings.trendingInterestKeywords` field; new endpoints `GET/POST
    /api/trending/interests(/add|/remove)` and `POST /api/trending/block-keyword` (direct-typed
    equivalent of the card's title-extraction `POST /api/trending/block`).

## 2026-10-27 (3)

- **Added a "not interested" button to the Trending card.** Clicking it extracts one distinctive
  keyword from the current item's title (`extractKeyword` in `trending.ts` — prefers a mid-title
  capitalized word or a camelCase brand name like "iPad"/"macOS" over a sentence-initial-capital
  or generic filler word, falling back to the longest remaining word) and adds it to a persisted
  blocklist (`Settings.trendingBlockedKeywords`). Every future item whose title or meta contains
  a blocked keyword (case-insensitive substring) is filtered out server-side before it's ever
  shown *or* logged to a daily note — not just hidden client-side. Already-cached items matching
  the new keyword are stripped immediately client-side too, rather than waiting for the next
  poll. A small "Manage blocked topics" toggle on the card lists everything currently blocked
  with a per-keyword unblock button, so a bad pick isn't permanent or invisible. New endpoints:
  `GET /api/trending/blocked`, `POST /api/trending/block`, `POST /api/trending/unblock`.
  This is a one-word heuristic, not real topic classification — one click won't instantly catch
  every related story, but it compounds with each click.

## 2026-10-27 (2)

- **The Trending card now logs every link it ever shows into a "Trending feed" section of that
  day's daily note** — so a headline/repo/post that rotates past before you catch it isn't gone.
  Each of the three sources diffs its freshly-fetched list against every URL logged before
  (persisted to `trending-seen.json` in `DATA_DIR`, so a container restart doesn't re-flood the
  note with yesterday's items) and only the genuinely-new ones get appended, as
  `[title](url) — meta` bullets. The section is created the first time anything needs logging
  that day, and — if the note already has a hand-written `## Claude activity log` section —
  slots in right after it, so the two stay in that order. Added `VaultIndex.appendToDaily()` in
  `vault.ts` (queued per-note, same pattern as `versions.ts`'s write queue, so the three sources
  refreshing close together can't race and clobber each other's addition) and a
  `startTrendingPoller(onNewItems)` callback in `trending.ts`.

## 2026-10-27

- **Replaced the home page's Notes and Tags stat cards** with two new ones:
  - **Trending** — rotates every 7s (pauses on hover) through a merged feed of Hacker News
    front-page stories, trending GitHub repos (no official "trending" API exists, so this
    approximates it via the Search API: repos created in the last week, sorted by stars), and
    top Lobsters posts. Backend (`trending.ts`) polls each source on its own cadence (HN/Lobsters
    every 20min, GitHub every 6h) and caches the results; the frontend just cycles through
    whatever's currently cached via a new `GET /api/trending`. Reddit was the original third
    source but its JSON/RSS endpoints 403 non-browser requests regardless of user-agent — swapped
    for Lobsters (`lobste.rs`), which has an open, documented API.
  - **EUR → ZAR** exchange rate, via Frankfurter (ECB reference rates, free, no key) — backend
    (`fx.ts`) refreshes hourly, keeps serving the last good rate on a transient fetch failure
    rather than blanking the card. New `GET /api/fx`.
  - `StatBar.tsx`'s color-customization keys were renamed to match (`notes`→`trending`,
    `tags`→`fx`) — same Settings-modal color pickers, just relabeled.
- **Backup checkpoint**: tagged `obsidian-dashboard:backup-20261027` (current — `backup-20261026-v6`
  is the checkpoint from just before this change).

## 2026-10-26

- **Added: a floating "dock" quick-nav** (`DockNav.tsx`) — a glass-pill bottom bar, prototyped
  first as an Artifact mockup at the user's request. Sits alongside the existing sidebar (not a
  replacement): Home, Tasks, Mail, a "Today's Note" quick action (reuses `TodayNote.tsx`'s own
  `getOrCreateDaily` call, now exported as `todayDateString`), Stats, Explorer, Bookmarks, plus a
  grid icon opening an overflow panel for Calendar, Graph, Inbox, Orphans, Duplicates, Dead
  attachments, and Specs. Reuses the sidebar's exact active-state (`bg-violet-500/20
  text-violet-300`) and badge styling, and the same Phosphor icons as the collapsed sidebar rail,
  so it reads as one system rather than a bolted-on second nav. Self-polls unread mail like
  `GmailWidget` does, same `/api/mail/unread` cache key. Desktop-only (`md:` and up, hidden in zen
  mode) — the existing mobile bottom nav is untouched.
- **Added: inline `![alt](url)` image rendering in the editor's live preview.** Previously an
  embedded/pasted image just sat there as raw markdown text while editing — `Image` wasn't one of
  the syntax-tree node types `liveMarkdownPreview.ts` decorated at all. Now, same hide-while-the-
  cursor-is-on-that-line convention as everything else in the live preview, an image line renders
  as an actual `<img class="cm-image-embed">` thumbnail (capped at 320px tall) once the cursor
  moves off it, and reverts to editable raw text while it's active. Vault-relative paths (what
  `uploadAndInsert`'s paste/drop handler writes) are routed through `/api/attachments/<path>`,
  same endpoint the read view's resolved image embeds use; `http(s)://` URLs pass through as-is.
  Also fixed a side effect this surfaced: an image's raw `(url)` text was being styled blue like a
  bare autolink even outside the widget case, since the existing `URL` node handling only special-
  cased a `Link` parent, not an `Image` one.
- **Fixed: clicking a `[[wikilink]]` in the read view opened a new tab instead of split
  view.** `react-markdown`'s default `urlTransform` only allows `http(s)`/`irc(s)`/`mailto`/
  `xmpp` URL schemes and silently blanks anything else, including our own
  `obsidian://note/...` / `obsidian://unresolved/...` hrefs — so the custom `a` renderer's
  `obsidian://` prefix checks never matched, and every internal link fell through to the
  generic external-link branch (empty `href`, `target="_blank"`), which just opens a blank/
  duplicate tab. `NoteView.tsx`'s `ReactMarkdown` now passes a custom `urlTransform` that lets
  `obsidian://` URLs through untouched and defers to the default sanitizer for everything else.
- **Fixed: `[[wikilink` clicks in the editor needed Ctrl/Cmd and nobody was told.** The
  previous change ("clicking a wikilink always opens a split view") quietly required
  Ctrl/Cmd+click inside the editor specifically — a plain click did nothing, which is why
  `[[Factorio Mods]]` in Today's Note looked broken. Now a plain click opens a wikilink
  whenever its line isn't the one you're actively editing (brackets hidden, same as the read
  view) — Ctrl/Cmd is only still needed to force-open a link sitting on the line your cursor
  is currently on, where you'd otherwise want a plain click to land the cursor in the link
  text instead. Matches Obsidian's own live-preview click behavior.
- **Fixed: entering split view could flash the same note in both panes.** Clicking a wikilink
  while not already split now clears the primary pane's note immediately instead of leaving
  the old one showing until the new note finishes loading — previously, for a split second,
  both the old note (pushed into the left pane) and the stale primary-pane state looked
  identical before the right pane swapped to the real target, which could read as the whole
  dashboard reloading.
- **Backup checkpoint**: tagged `obsidian-dashboard:backup-20261026-v3` (current — covers
  both fixes above; `backup-20261026-v2` is the checkpoint from just before them).
- **Backup checkpoint**: tagged `obsidian-dashboard:backup-20261026-v2`
  (before this change — `backup-20261026` is the checkpoint just before it,
  and `backup-20261022-v2` is the one before mail rules).
- **Clicking a `[[wikilink` now always opens a split view** instead of
  navigating away from (or, in the editor, opening a new tab from) whatever
  you're currently looking at — the clicked note opens on the right, and
  what was on screen stays visible on the left. Applies everywhere a
  wikilink can be clicked: the rendered note view, Ctrl/Cmd+click in the
  editor, and Today's Note (which always opens a fresh split since it has
  no "current note" of its own to replace). Other internal navigation —
  backlinks, related notes, the outline rail — is unchanged and still
  navigates in place.
- **`[[wikilinks` now render properly in the editor** (previously only the
  rendered/read view did this): the `[[`/`]]` brackets hide outside the
  active line, same live-preview convention as everything else, and the
  note title is styled and clickable (Ctrl/Cmd+click) like a real link —
  violet instead of the external-link cyan, matching the read view's
  internal- vs. external-link colors. An unresolved target (typo, renamed
  or deleted note) just does nothing when clicked, same as the read view's
  dashed/inert treatment.
- **Backup checkpoint**: tagged `obsidian-dashboard:backup-20261026` (before
  this change — the pre-mail-rules checkpoint is still `backup-20261022-v2`).
- **`[[wikilink` autocomplete** in the editor: typing `[[` now pops up a
  list of notes right there in the editor (CodeMirror's own autocomplete,
  `@codemirror/autocomplete`) — the most recently edited notes when the
  brackets are still empty, narrowing to titles that *start with* whatever
  you type next (e.g. `[[Pla` -> every note titled "Pla…"), case-insensitive.
  Arrow keys + Enter to pick, Escape to dismiss. Picking one inserts
  `[[Note Title]]` and closes the brackets for you. Works in both the full
  note editor and the home-page Today's Note quick-capture box.

## 2026-10-22

- Opening a message's preview (clicking a row on the Mail page or in the
  home-page Unread Mail widget) now also marks it as read, once the body
  has actually loaded — no more needing a separate click after reading it.
  Doesn't fire on a failed load, since you never actually saw it.
- **Backup checkpoint**: tagged `obsidian-dashboard:backup-20261022-v2` and
  repointed `docker-compose.backup.yml` at it (say "revert" to roll back).
- **Mail rules**: a new "Mail rules" panel on the Mail page lets you set up
  sender → action rules (e.g. "noreply@" → mark as read, "@linkedin.com" →
  move to Trash). A background poller inside the server checks every 5
  minutes, independent of whether the dashboard is even open in a browser —
  not just "next time someone loads the Mail page." Every automatic action
  (not manual ones) gets logged — sender, subject, action, timestamp — so an
  auto-delete rule never silently disappears a message with nothing to show
  for it. Matching is a case-insensitive substring on the From address, same
  as the existing per-sender "mark as read" button. Rules/log live in the
  same server-side settings.json as everything else (quick links, tabs,
  etc.), so no new storage or API surface was needed.
- **Backup checkpoint**: tagged `obsidian-dashboard:backup-20261022` and
  repointed `docker-compose.backup.yml` at it (say "revert" to roll back).
- Fixed the `---` horizontal rule rendering with an oversized gap (the
  rule's own margin was stacking on top of the editor's normal line
  height instead of sharing it).
- Started this changelog, plus `FEATURES.md`/`SETUP.md`.
- **New "Explorer" view**: a two-pane file manager (recursive folder
  tree on the left, selected folder's notes on the right). Drag a note
  onto a folder to move it there (any depth, not just Resources
  subfolders). Drag `.md` files in from your OS file manager to import
  them into `1. Inbox` — a name collision gets `" DUPE"` appended so an
  accidental re-import stands out instead of quietly overwriting.
- Explorer: added "+ New" folder creation in the left pane (creates
  under whichever folder is currently selected) — backed by a new
  `GET/POST /api/folders`, which also fixed the tree only ever showing
  folders that already contain a note.
- Explorer: the left-pane tree now starts fully expanded by default
  (was collapsed past the top level). The right pane now also lists
  non-`.md` files (images, PDFs, etc.) in the selected folder — these
  aren't draggable yet, just visible, since moving them needs a
  separate non-note move path on the backend.
- Explorer: added a third "preview" pane. Click a note to render its
  content right there (lighter-weight than the full note view — no
  callout styling, no editing), or click an image/file to preview it
  (inline for images, "open in new tab" for anything else). A "Open →"
  button on a note preview jumps to the full note view.
- Explorer now uses the full content width (was capped at the
  `max-w-3xl` reading width, same as a plain note) with its three
  columns at a fixed 25% / 25% / 50% split (tree / list / preview).
- Explorer: each note row in the list pane now has a hover-reveal
  Archive button (moves straight to `5. Archive`, same as the existing
  Archive action elsewhere) — no more needing to drag it onto the
  Archive folder in the tree. Hidden for notes already in Archive.

## Earlier (not dated individually before this point)

- Live-preview markdown editor: real checkboxes for `- [ ]` task items,
  clickable styled links (Ctrl/Cmd+click to open; pasting a bare URL
  fetches its page title and inserts `[title](url)`), and `---`
  thematic breaks rendered as an actual line.
- Personal/Work toggle: Work mode hides the home page's unread-mail
  column and the StatBar's Mail segment (the top toolbar's unread-count
  pill still works either way).
- Daily notes build from `_Templates/daily-note.md` (with `{{date}}`
  substitution) when that template file exists, falling back to the
  original minimal frontmatter + heading otherwise.
- Gmail unread-mail widget (multi-account, mark-as-read, mark-all-read,
  per-sender actions), home-lab performance widget (CPU/temp/mem/disk),
  sports-events card, downloads widget, calendar view, system specs
  view, version history/snapshots on edited notes.
