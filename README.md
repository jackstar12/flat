# Flat Web

Local web app for shared-flat finances and chores. It runs as one Bun service behind authenticated ingress.

## Local architecture

- React/Vite frontend, built into `dist/`
- Hono API served by Bun
- SQLite data in `data/flat.sqlite`
- Receipt analysis through a private OpenAI-compatible Responses API
- No Wrangler, D1, or Workers AI runtime dependency

## Setup

Requirements: Bun, Poppler (`pdftoppm`), and server-only `OPENAI_BASE_URL` / `OPENAI_API_KEY` configuration.

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

Use SQLite’s online backup API for a consistent running-service backup, or stop the service before copying the database and any WAL companions. Override the location with `FLAT_DATABASE_PATH`.

## Receipt analysis

Assignment rules are structured records in SQLite and can be added, edited, deleted, and saved directly in the receipt dialog. Item rules take precedence over category rules; unmatched items are split equally.

The server uses native fetch against `${OPENAI_BASE_URL}/responses`, with `gpt-5.6-sol` and low reasoning. Set `OPENAI_BASE_URL=https://inference.tail685c39.ts.net/v1` and provision `OPENAI_API_KEY` in the private service environment (`/srv/app-data/flat/flat.env`, mode 0600); never put credentials in Git or browser code.

Requests include the unchanged receipt prompt and strict JSON schema, with no tools. Images are sent as data URLs; PDFs are locally rasterized with Poppler at 160 DPI, up to eight pages. Temporary files are removed after each request. Inference has a three-minute deadline, a 16,384-token output ceiling and a 2 MB response limit. Responses are validated against the requested schema before existing receipt normalization. Provider errors are not exposed.

## Checks

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
```
