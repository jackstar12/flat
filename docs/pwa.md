# Install Hugo Wolfgang

Hugo Wolfgang can be installed from a supporting browser. **Internet access and
a valid Authentik login are required to use it**, including when opening it from
the home screen. Installation does not grant access or extend a session.

1. Open `https://flat.kranawetter.dev` and sign in normally with your own email
   code. Confirm that the app displays your expected roommate.
2. In Chrome/Edge, use the browser's install action in the address bar or menu
   when offered. On Android, use the browser's install/add-to-home-screen action.
   On iPhone/iPad, open the page in Safari, then use Share → Add to Home Screen
   (enable Open as Web App if offered). Browser wording and support vary.
3. Open **Hugo Wolfgang** from the launcher/home screen. The supporting browser
   opens the app in a standalone window. If that window needs a new login,
   complete the normal Authentik flow there; browser and installed-app sessions
   may differ. A bookmark alone does not demonstrate standalone installation.

There is no custom install banner, notification permission request or push
subscription. Uninstall using the OS/browser's ordinary app controls.

## Online and authentication behavior

The worker never stores app pages, receipts, account information or financial
data in CacheStorage. It has no request queue, background sync, mutation replay,
push handler or analytics. API requests and mutations use the ordinary network
path, preserving existing server authorization and HTTP cache policy.

Only a failed GET navigation to `/` can return the worker's inline, generic
offline document. It contains no user data and no application scripts. It offers
a manual retry. HTTP errors (including 401/403/503) and login redirects pass
through unchanged. Authentik/outpost paths, API paths, assets and receipt links
have no offline fallback. An already open page can still display data or a draft
in memory; this feature does not make that data available after an offline reload
and does not add storage for it.

An expired API session retains the existing **Erneut anmelden** behavior. A draft
stays visible until you navigate away. Nothing is automatically resubmitted.
After signing in, inspect the saved state before re-entering a transaction,
especially after an interrupted multi-step receipt upload.

## Implementation and updates

- The stable manifest `id`, `start_url` and `scope` are `/`. Display is
  `standalone`; the title/name/short name are exactly **Hugo Wolfgang**.
  Theme/background match the app's `#f7f8f4` background.
- The manifest link uses `crossorigin="use-credentials"` so browser requests
  include the existing gate's cookies. The manifest, PNG icons and `/sw.js`
  remain behind the same authentication gate. There are no public-resource
  exceptions or changes to ingress, mappings or permissions.
- The plain JavaScript worker at `/sw.js` naturally has root scope. The production
  entry registers it with `scope: "/"` and `updateViaCache: "none"`. The server
  gives worker and manifest explicit MIME, `private, no-store`, and `nosniff`
  headers for GET and HEAD. Vite dev does not register a worker.
- Worker installation/activation claims clients without reloading them. Changed
  worker bytes activate via the browser update mechanism. Failed registration or
  updates (offline, 401, redirect to login, non-JavaScript login HTML) are caught;
  the browser retains an existing valid worker. No login is forced and drafts
  are not discarded. Registration retries on the next page entry or online event.
- Icons include 192/512 PNG, a separate 512 maskable entry and a 180 Apple touch
  icon. The opaque SVG source keeps the house/monogram within the maskable safe
  circle. To regenerate: `bun scripts/generate-pwa-icons.ts`, optionally setting
  `PLAYWRIGHT_CHROMIUM_PATH` to an installed Chromium executable.

The credentialed manifest follows [Chrome's manifest guidance](https://web.dev/articles/add-manifest).
Worker script validation and update failure follow the [Service Workers specification](https://www.w3.org/TR/service-workers/).

## Automated and human acceptance

Run `bun run typecheck`, `bun run test`, `bun run build`, then
`bun run test:e2e`. The E2E suite starts an isolated temporary SQLite backend and
a separate **test-only** loopback cookie gateway, with synthetic identity values.
It uses fresh temporary regular Chromium profiles on trustworthy localhost, including
desktop and mobile emulation. It never uses a production cookie, OTP or identity
map. The gateway is test source only and refuses the live backend port 8787.

The PWA tests cover actual cookie-authenticated entry and manifest loading,
PNG decoding/dimensions, root registration/control, Chromium CDP manifest and
installability checks, unauthenticated gating, expired draft/login behavior,
offline fallback/no replay/no private CacheStorage, and real worker update fetches
including redirected, HTML and 401 responses. Existing finance, task, receipt and
single-heading regressions still run.

On a host serving live assets from `dist/`, **build and test a source copy outside
the live checkout**, exclude all canonical data/env files, and symlink its
`node_modules` to the installed dependencies. Keep all test reports/screenshots
in that staging directory. Use a temporary test DB as configured; never start a
test server against the canonical database.

Automation does not prove a human's real email-code login, Authentik's live
cookie behavior on every browser, or an OS-installed launch. After coordinator
review/deployment, a human must complete steps 1–3 on the public origin and check
the displayed roommate, one Hugo Wolfgang heading, standalone launch, expiry on
an unsaved draft and generic offline reopening. Do not create synthetic expenses
in production. If a browser cannot fetch install resources through the existing
gate, record its network/console evidence and propose the smallest necessary
resource exception for review **before** changing infrastructure. An absent
install action alone is not evidence that public assets are required.
