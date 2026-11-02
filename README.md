# Vault Dashboard

![version](https://img.shields.io/badge/version-1.0.0-blue) ![docker](https://img.shields.io/badge/docker-self--hosted-2496ED) ![license](https://img.shields.io/badge/license-none-lightgrey)

A full browser-based dashboard for an [Obsidian](https://obsidian.md) vault — not just a
read-only viewer, but a real second way to live in your notes day to day. It runs as a single
Docker container alongside your existing vault folder (no changes to your actual `.md` files'
format, no Obsidian plugin required) and gives you:

- **Search** across titles, body text, tags, and frontmatter, fuzzy + prefix matching.
- A **live-preview Markdown editor** (CodeMirror 6, Obsidian-style) — wikilinks, checkboxes,
  images, code blocks, callouts all render as their final styled form while you type.
- **Organizing tools** most pure-viewer dashboards skip entirely: Inbox triage, a drag-and-drop
  two-pane file Explorer, orphan/duplicate/dead-attachment maintenance views.
- A handful of genuinely useful extras most people end up wanting next to their notes anyway:
  an unread-mail widget, home-lab host stats, a calendar, quick links, bookmarks, a trending-feed
  card, and an exchange-rate ticker.

It's a single Fastify + TypeScript backend serving a React + Vite + TypeScript + Tailwind
frontend, built for a [PARA-method](https://fortelabs.com/blog/para/) vault (`1. Inbox`,
`2. Projects`, `3. Areas`, `4. Resources`, `5. Archive`, `6. Daily`) but most views — search,
editing, the Explorer, wikilinks — work regardless of your own folder structure.

## Quick start

```bash
git clone https://github.com/DevDemord/vault-dashboard.git
cd vault-dashboard
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env
# edit docker-compose.yml: point the "vault" volume at your actual Obsidian vault folder
# edit .env if you want the optional mail/downloads widgets (see "Environment variables" below)
docker build -t vault-dashboard:latest .
docker compose up -d
```

Then open `http://<your-host>:3015`.

Full history of what's changed between versions: **[CHANGELOG.md](./CHANGELOG.md)**.

---

## Features

### Home page

- **Trending card**: rotates every few seconds through tech headlines (Hacker News), trending
  GitHub repos, top Lobsters posts, and any RSS/Atom feed you've added yourself (see below) —
  one merged feed, pauses while you're hovering it, click to open the current item, or step
  through with the ‹ › arrows yourself. A small badge on the card names the source (e.g. "HN",
  "GH", or a custom source's own name). Every link it ever shows also gets logged into a
  dedicated `_Templates/trending-feed.md` note, grouped `## <date>` → `### <source>` so it's
  clear what came from where and when (first time only — no duplicates once an item's been
  logged), so nothing that rotated past before you caught it is actually lost — and Today's Note
  stays short.
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

### Browsing & search

- **Instant search** (press `/`) across note titles, body text, tags, and
  frontmatter — fuzzy + prefix matching via an in-memory index
  ([MiniSearch](https://github.com/lucaong/minisearch)).
- **Paste-a-URL-to-bookmark box**, right next to Quick search — Enter saves it as a new
  checkbox line in `_Templates/bookmarks-general.md`, which shows up in Bookmarks (below)
  immediately, no extra step.
- **Folder tree** sidebar mirroring the vault's real nested structure (PARA
  folders, sub-folders, arbitrary depth) — collapsible, remembered per-browser.
  A collapsed sidebar shows one icon per top-level PARA folder.
- **Floating dock nav** (desktop) — a glass-pill quick-nav
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
- **Calendar view**, including an optional sports-events card fed from
  `_Templates/sports-events.md`.
- **Tasks & Bookmarks**: a live scan of every note for `- [ ]`/`- [x]` lines.
  A checkbox whose text is nothing but a bare URL is a **bookmark**; anything
  else is a **task** (grouped by the nearest preceding heading).

### Editing

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

### Organizing

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
- **Vault activity** stats (note/tag/folder counts, recent edits) — also shows an **Activity
  log**: a dated, newest-first list of entries read from `_Templates/claude-activity-log.md` —
  handy as a running log of changes to your own vault or this dashboard's setup, whether you
  write entries by hand or have an AI assistant keep it updated for you.

### Mail

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

### System

- **Custom site icon**: Settings → General lets you upload an image that replaces the plain "V"
  glyph shown when the sidebar is collapsed. Stored server-side (not browser storage, not the
  vault), so it follows you across devices.
- **Home-lab performance widget** (optional): CPU/temperature, memory, disk, read live
  from the host the container runs on — see "Home-lab stats widget" below for how to wire it up.
- **System specs view**, **downloads widget** (optional, recent downloads feed from a separate
  self-hosted downloader if you run one), quick links panel, adjustable reading width,
  customizable tab dock / open-tabs bar, split-view (open a second note side-by-side; the
  non-note side renders the full home dashboard, not a cut-down picker).
- Settings persist server-side (not browser `localStorage`), so they follow
  you across devices/browsers: quick links, open tabs, reading width,
  callout colors, column layout, Personal/Work mode, etc.
- Reloading the page (or the browser's own refresh button) lands you back on whatever note you
  were reading or editing, instead of resetting to the home dashboard.

### What's intentionally NOT built here

- No note deletion that bypasses `.trash` — nothing in this app permanently
  erases a file.
- No rename/delete-folder in the Explorer yet — just create (+ New), move
  (drag), and import (drag). Could be added later if it turns out to be
  needed.
- No multi-file select-and-drag (Explorer move is one file at a time by
  design — see CHANGELOG.md for the reasoning).

---

## Setup

### Project layout

```
vault-dashboard/
├── Dockerfile                   # 3-stage build: web build -> server build -> runtime image
├── docker-compose.example.yml   # copy to docker-compose.yml and edit for your setup
├── .env.example                 # copy to .env and fill in optional secrets
├── web/                # React + Vite + TypeScript + Tailwind frontend
│   └── src/
│       ├── App.tsx               # layout: sidebar, main view switch, top toolbar
│       └── components/           # one file per view/widget/modal
└── server/             # Fastify + TypeScript backend
    └── src/
        ├── index.ts     # API routes + serves the built web app
        ├── vault.ts     # recursive scan, MiniSearch index, file watcher, all note writes
        ├── mail.ts      # IMAP (unread mail widget + Mail view) + the mail-rules background poller
        ├── settings.ts  # server-side settings.json (quick links, tabs, Work/Personal, ...)
        ├── versions.ts  # per-note save snapshots
        ├── hostMetrics.ts, downloads.ts, linkTitle.ts  # smaller feature-specific helpers
        └── markdown.ts  # wikilink/embed rewriting + checklist-item extraction
```

### Running locally (dev, without Docker)

```bash
cd server && npm install && VAULT_DIR=/path/to/vault npm run dev   # http://localhost:3015 (API)
cd web && npm install && npm run dev                               # http://localhost:5173 (UI, proxies /api to :3015)
```

### Docker

**Build:**

```bash
docker build -t vault-dashboard:latest .
```

**Typecheck** (standalone, doesn't touch the deployed image):

```bash
cd web && docker run --rm -v "$(pwd)":/app -w /app node:20-alpine \
  sh -c "npm install --silent >/dev/null 2>&1; npx tsc --noEmit -p tsconfig.json"
```

(4 pre-existing errors in `GraphView.tsx`, unrelated to `force-graph`'s own
type definitions, are expected and not a regression.)

**Run** — see [`docker-compose.example.yml`](./docker-compose.example.yml). Copy it to
`docker-compose.yml`, point the `vault` volume at your real vault folder, and give the `data`
volume a real host path (not an anonymous volume, or settings/history get wiped on recreate):

```yaml
services:
  vault-dashboard:
    image: vault-dashboard:latest
    container_name: vault-dashboard
    restart: unless-stopped
    ports:
      - "3015:3015"
    env_file: .env
    volumes:
      - "/path/to/your/obsidian/vault:/app/vault"
      - "/path/to/persistent/data:/app/data"
```

#### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3015` | Port the server listens on. |
| `VAULT_DIR` | `/app/vault` | Where the vault is mounted inside the container. |
| `DATA_DIR` | `/app/data` | Where `settings.json` and note-version snapshots are persisted — needs its own volume, or settings/history don't survive a container recreate. |
| `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` (+ `_2`, `_3`, ...) | unset | Optional. Feeds the unread-mail widget via read-only IMAP, one numbered pair per account (numbering must stay contiguous from 1, no gaps). The password is a Google **app password** (needs 2FA enabled), generated at <https://myaccount.google.com/apppasswords> — not the real account password. Leave all absent and the mail widget just doesn't render. |
| `IG_DASHBOARD_URL` | unset | Optional. Point this at a separate self-hosted downloads dashboard if you run one (an Instagram/TikTok/YouTube/Pinterest downloader) — leave it unset and the widget just doesn't find anything. |

Put real secrets in your own `.env` (gitignored — see `.env.example`), never commit them.

#### Volumes

- **Vault mount** is read-write: note creation, editing, Explorer move/import,
  Archive/Trash, and task-checkbox toggling all write to it. The server never
  silently overwrites a file it didn't create or that the user didn't ask to
  edit/move — new-file writes use the `wx` (create-exclusive) flag, and the
  only in-place edits are explicit user actions (saving an open note,
  toggling a checkbox).
- **Data mount** (`/app/data`) holds `settings.json` (quick links, open
  tabs, reading width, callout colors, Work/Personal mode, mail rules + the
  mail-rules automated-action log, ...) and version snapshots — give it a
  real host path, not an anonymous volume, or a container recreate wipes it.

#### Mail rules poller

`startMailRulePoller()` (called once at server startup in `index.ts`) runs
a `setInterval` every 5 minutes for as long as the container is up —
independent of whether anyone has the dashboard open in a browser. No extra
env vars or config: it reuses whatever `GMAIL_ADDRESS`/`GMAIL_APP_PASSWORD`
accounts are already configured and reads/writes rules + the action log
straight from `settings.json` (`mailRules`, `mailRuleLog`). If a poll tick
fails for one account (bad credentials, network hiccup), it's logged to the
container's stdout prefixed `[mail-rules]` (`docker logs vault-dashboard`)
and the other accounts/next tick are unaffected — nothing retries in a
tight loop.

#### Redeploying after a code change

```bash
docker build -t vault-dashboard:latest .
docker compose up -d
curl -s http://127.0.0.1:3015/api/health
curl -s http://127.0.0.1:3015/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'   # confirm the new bundle is actually being served
```

#### Home-lab stats widget (optional)

The CPU/temp/memory/disk card on the home page reads a JSON snapshot written by a host-side
cron job — the container itself isn't granted access to the host's `/proc`, `/sys`, or
`lm-sensors`. If you want it, write a small script that dumps that data into your data volume
once a minute (e.g. via `cron`) in the shape `HostMetrics` expects in `server/src/types.ts`.
Skip it and the widget just shows a muted "unavailable" notice instead of hiding itself.

### Backups / rolling back

The source is a git repo (`git log --oneline` for current history). A simple pattern that works
well for a single-host homelab deploy:

- Keep a `docker-compose.backup.yml` override next to your real compose file, pinning `image:`
  to a dated `vault-dashboard:backup-YYYYMMDD[-vN]` tag.
- To roll back: `docker compose -f docker-compose.yml -f docker-compose.backup.yml up -d`
- To return to normal: `docker compose -f docker-compose.yml up -d` (omit the override).

Before any risky change: commit the current working state to git, tag a fresh
`vault-dashboard:backup-YYYYMMDD[-vN]` image from whatever is currently live, and repoint
`docker-compose.backup.yml` at it.

---

## Changelog

Every release gets a dated entry in **[CHANGELOG.md](./CHANGELOG.md)**, newest first.

## Status

Built for personal use and shared as-is — no license file, so it's not open for
redistribution/modification under copyright law, but you're welcome to clone it and run it
yourself in your own homelab.
