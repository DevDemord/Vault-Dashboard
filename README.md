# Vault Dashboard

A browser dashboard for an Obsidian vault — search, browse, edit (with a
live-preview Markdown editor), organize (Inbox triage, a two-pane Explorer),
and a few extras (unread mail, home-lab stats, calendar) layered on top.

Self-hosted, Docker-based, built for a PARA-style vault (`1. Inbox`, `2. Projects`,
`3. Areas`, `4. Resources`, `5. Archive`, `6. Daily`) but most views work regardless of
your folder structure.

## Quick start

```bash
git clone https://github.com/DevDemord/vault-dashboard.git
cd vault-dashboard
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env
# edit docker-compose.yml to point the "vault" volume at your actual vault folder
docker build -t vault-dashboard:latest .
docker compose up -d
```

See **[SETUP.md](./SETUP.md)** for the full walkthrough, env vars, and volumes.

- **[FEATURES.md](./FEATURES.md)** — what it does.
- **[SETUP.md](./SETUP.md)** — how it's deployed/configured, env vars,
  backups.
- **[CHANGELOG.md](./CHANGELOG.md)** — dated history of changes.

## Status

Built for personal use and shared as-is — no license file, so it's not open for
redistribution/modification under copyright law, but you're welcome to clone it and run it
yourself in your own homelab.
