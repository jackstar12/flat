# Flat Web

Local web app for shared-flat finances and chores. It runs as one Bun service and is intended to be exposed only inside a Tailnet.

## Local architecture

- React/Vite frontend, built into `dist/`
- Hono API served by Bun
- SQLite data in `data/flat.sqlite`
- Receipt analysis through the authenticated local `codex` CLI
- No Cloudflare, Wrangler, D1, or Workers AI dependency

## Setup

Requirements: Bun, Poppler (`pdftoppm`), and an authenticated Codex CLI on the service account.

```bash
bun install
cp .env.example .env
```

Set a private 64-hex `FLAT_PROXY_TOKEN`, matching only the authenticated ingress, and retain the long random `SESSION_SECRET` for roommate attribution sessions. Every request except GET/HEAD health requires server-to-server proof. The browser selects a roommate after Authentik authentication; there is no app password. Never expose the proof token in frontend code, Git or responses. Preserve exact `FLAT_TRUSTED_ORIGINS` for CSRF.

Start the frontend and API in development mode:

```bash
bun run dev
```

The frontend is then available at `http://127.0.0.1:5173`; Vite proxies API requests to the Bun server on port 8787.

Build and run the single production-style service:

```bash
bun run build
bun run serve
```

It listens on `http://127.0.0.1:8787` by default. `GET /healthz` is the unauthenticated health check. Keep `HOST=127.0.0.1` when placing Tailscale Serve or a local reverse proxy in front of it.

Install the included user service on this host:

```bash
systemctl --user link /home/jacksn/flat/deploy/flat-web.service
systemctl --user enable --now flat-web.service
```

Inspect it with `systemctl --user status flat-web.service` and `journalctl --user -u flat-web.service`.

## Data and migrations

The server creates the SQLite database and applies unapplied files from `migrations/` at startup. Migrations can also be applied explicitly:

```bash
bun run db:migrate
```

Back up `data/flat.sqlite` (and its `-wal`/`-shm` companions while the service is running), or stop the service before copying the main file. Override the location with `FLAT_DATABASE_PATH`.

## Receipt analysis

Assignment rules are structured records in SQLite and can be added, edited, deleted, and saved directly in the receipt dialog. Item rules take precedence over category rules; unmatched items are split equally.

The API invokes `codex exec` with:

- an ephemeral session;
- a read-only sandbox in a temporary directory;
- the receipt image or locally rendered PDF pages, when supplied;
- a strict receipt JSON schema.

The temporary image, schema, and model response are removed after every request. The service account must already be logged into Codex (`codex login status`). A receipt request can take up to three minutes.

## Checks

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
```
