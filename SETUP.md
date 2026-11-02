# Setup

Deployment and configuration. See [FEATURES.md](./FEATURES.md) for what the
app does and [CHANGELOG.md](./CHANGELOG.md) for a dated history of changes.

## Project layout

```
vault-dashboard/
├── Dockerfile          # 3-stage build: web build -> server build -> runtime image
├── docker-compose.example.yml  # copy to docker-compose.yml and edit for your setup
├── .env.example                # copy to .env and fill in optional secrets
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

## Quick start (Docker)

```bash
git clone https://github.com/DevDemord/vault-dashboard.git
cd vault-dashboard
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env
# edit docker-compose.yml: point the "vault" volume at your actual Obsidian vault folder
# edit .env if you want the optional mail/downloads widgets (see table below)
docker build -t vault-dashboard:latest .
docker compose up -d
```

Then open `http://<your-host>:3015`.

## Running locally (dev, without Docker)

```bash
cd server && npm install && VAULT_DIR=/path/to/vault npm run dev   # http://localhost:3015 (API)
cd web && npm install && npm run dev                               # http://localhost:5173 (UI, proxies /api to :3015)
```

## Docker

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

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3015` | Port the server listens on. |
| `VAULT_DIR` | `/app/vault` | Where the vault is mounted inside the container. |
| `DATA_DIR` | `/app/data` | Where `settings.json` and note-version snapshots are persisted — needs its own volume, or settings/history don't survive a container recreate. |
| `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` (+ `_2`, `_3`, ...) | unset | Optional. Feeds the unread-mail widget via read-only IMAP, one numbered pair per account (numbering must stay contiguous from 1, no gaps). The password is a Google **app password** (needs 2FA enabled), generated at <https://myaccount.google.com/apppasswords> — not the real account password. Leave all absent and the mail widget just doesn't render. |
| `IG_DASHBOARD_URL` | unset | Optional. Point this at a separate self-hosted downloads dashboard if you run one (an Instagram/TikTok/YouTube/Pinterest downloader) — leave it unset and the widget just doesn't find anything. |

Put real secrets in your own `.env` (gitignored — see `.env.example`), never commit them.

### Volumes

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

### Mail rules poller

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

### Redeploying after a code change

```bash
docker build -t vault-dashboard:latest .
docker compose up -d
curl -s http://127.0.0.1:3015/api/health
curl -s http://127.0.0.1:3015/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'   # confirm the new bundle is actually being served
```

### Home-lab stats widget (optional)

The CPU/temp/memory/disk card on the home page reads a JSON snapshot written by a host-side
cron job — the container itself isn't granted access to the host's `/proc`, `/sys`, or
`lm-sensors`. If you want it, write a small script that dumps that data into your data volume
once a minute (e.g. via `cron`) in the shape `HostMetrics` expects in `server/src/types.ts`.
Skip it and the widget just shows a muted "unavailable" notice instead of hiding itself.

## Backups / rolling back

The source is a git repo (`git log --oneline` for current history). A simple pattern that works
well for a single-host homelab deploy:

- Keep a `docker-compose.backup.yml` override next to your real compose file, pinning `image:`
  to a dated `vault-dashboard:backup-YYYYMMDD[-vN]` tag.
- To roll back: `docker compose -f docker-compose.yml -f docker-compose.backup.yml up -d`
- To return to normal: `docker compose -f docker-compose.yml up -d` (omit the override).

Before any risky change: commit the current working state to git, tag a fresh
`vault-dashboard:backup-YYYYMMDD[-vN]` image from whatever is currently live, and repoint
`docker-compose.backup.yml` at it.

## Changelog

Every deploy gets a dated entry in [CHANGELOG.md](./CHANGELOG.md), newest
first — add one whenever you ship a change here.
