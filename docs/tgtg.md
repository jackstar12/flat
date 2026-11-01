# TGTG in Flat

Entry: https://flat.kranawetter.dev/tgtg — native **TGTG** navigation tab.
Uses Flat's existing Authentik WG + active-user gate and exact email/UID roommate
mapping, including every `/api/tgtg/*` request. No separate login/provider/domain.

## Data and privacy

- Canonical data stays in `/home/jacksn/workspace/tgtg-history/state/history.sqlite`.
  Existing `tgtg-dashboard.service` serves a read-only helper on loopback 8797 only.
  No new database, collector, polling schedule or account writes.
- `server/tgtg.ts` forwards only catalog/history/photo GETs. It builds identity from
  the already verified roommate, never client parameters/headers. The private
  proof comes from `~/.config/tgtg-dashboard/proxy-token`, never the browser.
- Only existing roommate `kran` maps to the owner's personal view. Other mapped WG
  members get general bag/price/pickup/stock/history; app favourites, local
  preferences, reviews, buy-again verdicts and personal counts are omitted by the
  helper. Unknown identities and stale actors are rejected before the bridge.
- Shared anchor is public Univiertel centre, not the user's live location. Distance
  is straight-line, not verified cycling time. Saved prices are observations,
  not guaranteed fixed prices; min/max and in-stock minimum are distinct.
- App favourites use saved authenticated `raw.favorite` flags; tracker preferences
  are a separate filter. Only exact-item feedback is shown; negative buy-again
  verdicts remain visible to the owner.
- Photos use the helper's saved-URL allowlist, bounded image validation and memory
  cache; browsers contact only Flat. Generic images are labelled, failures use
  a neutral fallback. All bridge responses are private/no-store.

## Operations and verification

Flat stays on loopback 8787 with its existing private DEV :18787 ingress. Do not
remove that route when retiring the old dashboard :18796 / `svc:tgtg` routes.
The standalone `tgtg.kranawetter.dev` route/provider is retired; infra owns cleanup.

Typecheck and the package unit/API suite include `server/tgtg.bun.test.ts`.
`e2e/tgtg.spec.ts` tests the saved tracker data read-only while all Flat financial
and task state uses the existing isolated temporary E2E database. It needs the
local helper and proof available; it is not a production-user login. Run with
`TMPDIR=/tmp` to satisfy the existing E2E temporary-path guard. Build to a staged
`dist` outside the live checkout before browser tests; install hashed assets
first and atomically replace index last. Backend changes require restarting only
`flat-web.service`. No new SQL migrations.

Verified 2026-11-01: desktop/mobile search, combined stable/rating filters, MEET
price/rating/photos, exact Sorger verdict, app/local favourites, history and WG
personal-data exclusion. Existing finance/task header and mobile checks passed.
Native Flat policy permits the three WG accounts and denies the other current
accounts. Public page/API boundaries tested separately from isolated identities.
Actual human authenticated public login remains untested.
