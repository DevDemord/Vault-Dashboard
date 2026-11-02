# Features

A tour of what the Vault dashboard actually does, grouped by area. See
[SETUP.md](./SETUP.md) for deployment/config and [CHANGELOG.md](./CHANGELOG.md)
for a dated history of changes.

## Home page

- **Trending card**: rotates every few seconds through tech headlines (Hacker News), trending
  GitHub repos, top Lobsters posts, and any RSS/Atom feed you've added yourself (see below) —
  one merged feed, pauses while you're hovering it, click to open the current item, or step
  through with the ‹ › arrows yourself. A small badge on the card names the source (e.g. "HN",
  "GH", or a custom source's own name). Every
  link it ever shows also gets logged into a dedicated `_Templates/trending-feed.md` note,
  grouped `## <date>` → `### <source>` so it's clear what came from where and when (first time
  only — no duplicates once an item's been logged), so nothing that rotated past before you
  caught it is actually lost — and Today's Note stays short.
  - **"✕ not interested"** on the card hides the current item and blocks a keyword guessed from
    its title — future items matching it (any source) never show up or get logged again. "Manage
    blocked topics" on the card lists everything currently blocked, each removable.
  - A **"Feed" section in Settings** manages the same blocklist directly (type a word, no need to
    wait for a matching item first), plus an **"interested in"** list — matching items show up
    roughly twice as often in the rotation instead of once per cycle.
  - That same section's **"Sources"** list names the built-ins (Hacker News, GitHub, Lobsters)
    and lets you add your own — a tech blog, a subreddit, a newsletter, anything with an
    RSS/Atom feed. Adding one fetches and parses it right away, so a bad URL or a site that
    blocks non-browser requests tells you immediately instead of silently never showing
    anything.
- **Exchange rate card**: rotates every few seconds through EUR/USD/GBP → ZAR (hourly, via
  Frankfurter/ECB) and BTC/ETH → ZAR (every 2 minutes, via CoinGecko) — pauses while you're
  hovering it, same as Trending, with its own ‹ › arrows to step through manually. A ⟳ button
  forces an immediate refresh of all five instead of waiting for the next scheduled poll.

## Browsing & search

- **Instant search** (press `/`) across note titles, body text, tags, and
  frontmatter — fuzzy + prefix matching via an in-memory index
  ([MiniSearch](https://github.com/lucaong/minisearch)).
- **Paste-a-URL-to-bookmark box**, right next to Quick search — Enter saves it as a new
  checkbox line in `_Templates/bookmarks-general.md`, which shows up in Bookmarks (below)
  immediately, no extra step.
- **Folder tree** sidebar mirroring the vault's real nested structure (PARA
  folders, sub-folders, arbitrary depth) — collapsible, remembered per-browser.
  A collapsed sidebar shows one icon per top-level PARA folder.
- **Floating dock nav** (desktop, `DockNav.tsx`) — a glass-pill quick-nav
  pinned to the bottom of the screen, alongside the sidebar rather than
  replacing it: Home, Tasks, Mail, Today's Note, Stats, Explorer, Bookmarks,
  plus a grid icon that opens everything else the sidebar offers (Calendar,
  Graph, Inbox, Orphans, Duplicates, Dead attachments, Specs). Same
  active-state styling and badge counts as the sidebar's own collapsed rail,
  so the two read as one system. Hidden in zen mode.
- **Tag rail** — click a tag to filter the folder tree/home list to notes that
  have it.
- **Rendered notes**: `[[wikilinks]]` resolve to clickable internal navigation
  (dashed/grey if the target doesn't exist), including links inside
  frontmatter properties. `![[image.png]]` embeds render inline. A
  **backlinks** panel lists every note that links to the one you're viewing.
  Callouts (`> [!note]`) render Obsidian-style, with a settings modal for
  per-type color/icon.
- **Graph view** of the whole vault's link structure.
- **Calendar view**, including a sports-events card fed from
  `_Templates/sports-events.md`.
- **Tasks & Bookmarks**: a live scan of every note for `- [ ]`/`- [x]` lines.
  A checkbox whose text is nothing but a bare URL is a **bookmark**; anything
  else is a **task** (grouped by the nearest preceding heading).

## Editing

- A full **live-preview Markdown editor** (CodeMirror 6, Obsidian-style):
  headings, bold/italic/strikethrough, inline code and fenced code blocks
  (collapsible), blockquotes, list markers, `---` horizontal rules, and
  `![alt](url)` images (rendered as an actual inline thumbnail, capped at
  320px tall) all render as their final styled form, reverting to raw
  syntax only on whichever line your cursor is currently on.
  - **`[[wikilink` autocomplete**: typing `[[` pops up a list of notes —
    the most recently edited ones while the brackets are still empty,
    narrowing as you type to titles that start with what you've typed so
    far (case-insensitive). Arrow keys + Enter to pick, Escape to dismiss;
    picking one inserts `[[Note Title]]`, closing brackets included.
  - **`[[wikilinks` render properly here too**: brackets hide outside the
    active line (same convention as every other syntax mark) and the title
    is styled/clickable like a real link (violet, vs. the external-link
    cyan) — Ctrl/Cmd+click to open it.
- **Clicking a `[[wikilink` always opens a split view** — the clicked note
  on the right, whatever you were looking at stays visible on the left.
  Works from the rendered note view and in the editor (including Today's
  Note, which has no "current note" to replace, so it always opens a fresh
  split). In the **rendered note view**, a plain click opens it. In the
  **editor** (including Today's Note), a plain click always just places the
  cursor there instead — never navigates away mid-edit — and Ctrl/Cmd+click
  opens it, consistently whether or not that's the line you were already
  editing. An unresolved link (typo, renamed/deleted note) does nothing when
  clicked. Other internal navigation — backlinks, related notes, the
  outline rail — still navigates in place, unchanged.
  - **Checkboxes** render as real, clickable `<input type="checkbox">`
    elements, not literal `[ ]` text.
  - **Links** render as clickable styled text (Ctrl/Cmd+click to open).
    Pasting a bare URL automatically fetches the page's `<title>` and
    inserts `[title](url)` instead of the raw link; pasting one over
    selected text links that text instead. Either way the cursor lands
    right after the link, so you can keep typing immediately.
  - Pasting an image uploads it to `_Attachments/` and inserts the embed.
- **Version history**: every save snapshots the previous content, browsable
  and diffable per note.
- **Today's Note**: an always-editing, autosaving quick-capture box on the
  home page, backed by `6. Daily/YYYY-MM-DD.md`. Built from
  `_Templates/daily-note.md` if that file exists (supports a `{{date}}`
  placeholder), otherwise a minimal default (frontmatter + heading).
- **+ New note**: creates a Resource note — title, optional Project/Area
  (picked from `2. Projects/`/`3. Areas/`, written as `[[wikilinks]]`), which
  `4. Resources/<folder>/` subfolder, optional body.

## Organizing

- **Inbox triage**: everything new lands in `1. Inbox`; a dedicated view lets
  you quick-move a note into an existing-or-new `4. Resources/<folder>`
  subfolder, archive it, or delete it (moves to the vault's `.trash`, same as
  Obsidian's own delete — never a permanent erase).
- **Explorer**: a two-pane file manager — a recursive folder tree (any depth,
  expanded by default) on the left, the selected folder's contents
  (notes *and* other files — images, PDFs, etc.) on the right.
  - Drag a note from the right pane onto any folder on the left to move it
    there (one file at a time). Non-note files show up too but aren't
    draggable yet — just visible, with their size.
  - Each note row has a hover-reveal **Archive** button — one click to
    `5. Archive`, no dragging required. Hidden for notes already there.
  - Drag `.md` files in from your own computer's file manager onto the right
    pane to import them into `1. Inbox`. A filename collision gets `" DUPE"`
    appended (not silently overwritten, not blended in as `" (2)"`) so an
    accidental re-import stands out and you can go clean it up.
  - Non-`.md` files dropped in are skipped with a toast explaining why.
  - A third pane previews whatever you click — a note's rendered content (a
    lighter-weight render than the full note view, with an "Open →" button
    to jump there), or an image/file (inline for images, a link to open
    anything else in a new tab).
  - **"+ New"** in the left pane creates a folder inside whichever one is
    currently selected (click a folder first, then "+ New"). Unlike the
    sidebar's folder tree, Explorer's tree reflects every real folder on
    disk, not just ones that already contain a note — so a brand-new empty
    folder shows up immediately.
- **Orphans** (notes nothing links to), **Duplicates** (possible repeat
  notes), **Dead attachments** (embedded files that no longer exist) — each
  its own maintenance view, with a badge count in the sidebar.
- **Vault activity** stats (note/tag/folder counts, recent edits) — also shows the **Claude
  activity log**: a dated, newest-first list of what's shipped to the dashboard itself, read from
  `_Templates/claude-activity-log.md`.

## Mail

- **Unread-mail widget**, read-only IMAP, supports multiple Gmail accounts at
  once (`GMAIL_ADDRESS`/`GMAIL_APP_PASSWORD`, `_2`, `_3`, ...).
- Mark a single message, a whole account, or everything from one sender as
  read, move/delete (to Trash) a message, browse other IMAP folders/labels.
- **Opening a message's preview marks it read** — clicking a row (Mail page
  or the home-page Unread Mail widget) marks that message read as soon as
  its body has actually loaded, so there's no separate "mark read" click
  needed after reading something.
- **Mail rules**: a "Mail rules" panel on the Mail page — sender (substring
  match on the From address, case-insensitive) → action (mark as read / move
  to Trash) → account scope (one account or all). A background poller inside
  the server checks every 5 minutes on its own, so a rule fires even if the
  dashboard isn't open in any browser. Every automatic action is logged
  (sender, subject, action, timestamp) in the same panel, capped at the last
  100, so an auto-delete rule never disappears a message silently.
- **Personal/Work toggle** in the top toolbar (home page only): Work mode
  hides the home page's unread-mail column and the StatBar's Mail segment
  (sender previews + counts) — e.g. for screen-sharing at work. The top
  toolbar's unread-count pill still works in both modes; it only opens the
  Mail view, it never previews a message inline.

## System

- **Custom site icon**: Settings → General lets you upload an image that replaces the plain "V"
  glyph shown when the sidebar is collapsed. Stored server-side (not browser storage, not the
  vault), so it follows you across devices.
- **Home-lab performance widget**: CPU/temperature, memory, disk, read live
  from the host the container runs on.
- **System specs view**, **downloads widget** (recent downloads feed), quick
  links panel, adjustable reading width, customizable tab dock / open-tabs
  bar, split-view (open a second note side-by-side; the non-note side renders
  the full home dashboard, not a cut-down picker).
- Settings persist server-side (not browser `localStorage`), so they follow
  you across devices/browsers: quick links, open tabs, reading width,
  callout colors, column layout, Personal/Work mode, etc.
- Reloading the page (or the browser's own refresh button) lands you back on whatever note you
  were reading or editing, instead of resetting to the home dashboard.

## What's intentionally NOT built here

- No note deletion that bypasses `.trash` — nothing in this app permanently
  erases a file.
- No rename/delete-folder in the Explorer yet — just create (+ New), move
  (drag), and import (drag). Could be added later if it turns out to be
  needed.
- No multi-file select-and-drag (Explorer move is one file at a time by
  design — see CHANGELOG.md for the reasoning).
