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

## Follow-up: fail-closed response validation — 2026-09-19

Independent review found that a completed top-level response could contain an error, unfinished/non-assistant messages, or tool output alongside valid JSON. The adapter now rejects every non-null envelope error and all output items except reasoning and completed assistant messages containing only string `output_text` parts. Refusal parts, including refusals mixed with valid text, are rejected. Reasoning alone cannot produce a result. This is a narrow adapter-boundary fix; model, reasoning, preprocessing, schema, normalization, timeouts, permissions and data flows remain unchanged.

Baseline was clean at `3de7394e50da2faaca0e5a960d08c8472f4e83e6`. Only the adapter, its regression tests and this evidence document changed. No infrastructure templates, service configuration, other repositories, proxy runtime or agency VPS were touched in this follow-up.

Final verification commands/results:

- `LD_LIBRARY_PATH=/tmp/thinkpad-chrome-libs/root/usr/lib/x86_64-linux-gnu python3 /home/jacksn/.cache/flat-inference-migration/run-hardening-tests.py` — passed. In the refreshed isolated source copy, this runs `bun run typecheck`, `bun run test`, `bun run build`, and `bun run test:e2e`, using the PATH and private credential-loading procedure above.
- Unit/API suite: **19 Vitest + 38 Bun tests passed** (57 total). The 17 added cases cover contradictory envelope errors, mixed tool/text output, unknown/null outputs, incomplete/in-progress/missing-status messages, non-assistant/missing roles, refusal-only and mixed-refusal content, non-string text, empty messages, reasoning-only rejection, and successful reasoning plus completed assistant text with a null error. Existing timeout, schema, PDF cap and authentication tests continue to pass.
- Isolated browser suite: **18 passed**, including two actual private image/schema inference calls; finance state was unchanged by analysis. URL `http://127.0.0.1:4387`, Playwright-managed child process, no unit. The process stopped, port closed, and this run's temporary SQLite/WAL/SHM files were deleted. The isolated source/build snapshot remains available.
- `systemctl --user restart flat-web.service` — only the local Flat unit restarted; verified PID `3702109`, cwd `/home/jacksn/flat`, executable `/home/jacksn/.bun/bin/bun`, URL `http://127.0.0.1:8787`.
- `python3 /home/jacksn/.cache/flat-inference-migration/verify-hardening-live.py` — passed live health, unauthenticated 401, authenticated session/cookie flags, foreign-origin 403, actual synthetic image/schema inference, tested-versus-deployed adapter bytes and process configuration. Full production SQLite logical contents matched the fresh pre-test online backup, and integrity passed. The synthetic analysis was never saved; no production records were created or changed, and none were printed.
- `git diff --check` and private credential-content scan — passed before committing.

Fresh rollback inputs for this follow-up are preserved at `/home/jacksn/.cache/flat-inference-migration/hardening-rollback` (0700), including the `3de7394` source archive/commit, build, unit, private environment and online database backup (sensitive files 0600). To undo only this hardening, revert its scoped commit and restart `flat-web.service`; no environment, unit or database restoration is needed. Preserve later unrelated work and never replace newer user data with the backup. The earlier full migration rollback remains separate.
