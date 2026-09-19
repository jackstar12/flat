# Private inference migration verification — 2026-09-19

Work was performed only on the local dev host. No agency VPS, infra repository, proxy configuration or OAuth credentials were accessed or changed. Baseline was clean at `060865e`, branch `master`, origin `https://github.com/jackstar12/flat.git`. No repository AGENTS.md was present. Other agent processes were active for the explicitly separate app work; this session was the authorized sole Flat writer.

The receipt adapter uses native fetch Responses API, model `gpt-5.6-sol`, low reasoning, no tools, strict existing schema and local schema validation. Existing normalization, permissions, receipt review, database and queue behavior are unchanged. No SDK was added. PDF rasterization remains 160 DPI and at most eight pages. Inference timeout remains 180 seconds; output is bounded to 16,384 tokens and 2 MB. Provider error bodies are discarded. The obsolete Codex adapter, naming and service write permission were removed.

## Commands and results

PATH for all Bun commands:
`/home/jacksn/.bun/bin:/home/jacksn/.nvm/versions/node/v24.18.0/bin:$PATH`

- `bun run typecheck` — passed, including the final tests.
- `bun run test` — 19 Vitest + 21 Bun tests passed. Includes real-fetch timeout, HTTP error redaction, invalid JSON/schema, additional-property rejection, incomplete/empty/oversized responses, actual Poppler conversion of nine synthetic pages capped at eight, and existing database/authentication tests.
- `bun run build` — passed in `/home/jacksn/.cache/flat-inference-migration/isolated`, keeping the live frontend build untouched. Frontend source was unchanged.
- `LD_LIBRARY_PATH=/tmp/thinkpad-chrome-libs/root/usr/lib/x86_64-linux-gnu python3 /home/jacksn/.cache/flat-inference-migration/run-tests.py` — runs `bun run typecheck`, `bun run build`, then `bun run test:e2e` in that isolated copy. All 18 desktop/mobile tests passed, including two real image/schema inference calls through the authenticated receipt handler. The helper reads only OPENAI_API_KEY programmatically from the private client environment, without logging it. Playwright uses `FLAT_TEST_REAL_INFERENCE=1` and `PLAYWRIGHT_CHROMIUM_PATH=/home/jacksn/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`.
- `python3 /home/jacksn/.cache/flat-inference-migration/verify-live.py` — passed: health, unauthenticated 401, authenticated session, Secure/HttpOnly/SameSite cookie, foreign-origin 403, actual private inference with synthetic image and schema, SQLite integrity and full logical contents equal to backup, process executable/cwd/environment and adapter bytes equal to the tested copy.
- `git diff --check` and credential-content scan — passed before commit.

The first browser attempt failed because Chromium lacked shared libraries. The successful run used an existing local library bundle; no system packages were changed. An immediate health probe raced service startup; the subsequent full verification passed.

## Deployments and state

Isolated URL: `http://127.0.0.1:4387`, managed by Playwright's child process, no systemd unit. Temporary SQLite databases were outside production. The harness has stopped, port 4387 is closed, and both test databases and their WAL/SHM files were deleted. The isolated source/build snapshot remains in the private cache for review.

Live local URL: `http://127.0.0.1:8787`, user unit `flat-web.service`, cwd `/home/jacksn/flat`, executable `/home/jacksn/.bun/bin/bun`. Existing public ingress is `https://flat.kranawetter.dev`; external ingress was not contacted as part of this local-only migration. Only this local user unit was restarted. Server configuration is in `/srv/app-data/flat/flat.env`, mode 0600, using `https://inference.tail685c39.ts.net/v1`. Its API key was provisioned programmatically from `~/.config/cliproxyapi/client.env` and never stored in Git.

No production records were created, edited or deleted. The live synthetic analysis only returned a review result; it was never saved. Full database logical-content hashes before and after matched the online backup, and integrity checks passed. No production records or credentials were printed.

## Rollback

Private rollback inputs are in `/home/jacksn/.cache/flat-inference-migration/rollback` (directory mode 0700): original source archive and commit, frontend build, original private environment, original unit, and an online SQLite backup (sensitive files mode 0600).

To roll back this migration, stop `flat-web.service`, revert this migration commit (preserving any later unrelated changes), restore the saved `flat.env`, `flat-web.service` and `dist`, run `systemctl --user daemon-reload`, then restart only `flat-web.service`. The original runtime expects the existing Codex installation/login. No database restore is required because this migration changes no data or schema; do not overwrite newer user data with the backup. Recheck local health and authentication afterward.
