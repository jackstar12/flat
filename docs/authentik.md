# Authentik identity and existing roommates

Public entry: `https://flat.kranawetter.dev`. Cloudflare → agency Caddy → private
`https://dev.tail685c39.ts.net:18787` → `127.0.0.1:8787`.
The node transport **must remain**. `svc:flat` and agency `:8787` are retired.

Caddy removes all incoming `X-Flat-*` and authentication identity headers, invokes
the existing native Authentik gate, copies only the successful response's
`X-Authentik-Email` and `X-Authentik-Uid` to `X-Flat-Email` and `X-Flat-Uid`, and
injects the private proxy proof. Flat requires all three on every request, including
static assets. Identity headers alone cannot authenticate. Unknown, missing,
joined/duplicate or conflicting identities fail closed. Private mapping configuration
rejects repeated emails, UIDs or roommate IDs at startup. Email matching is case-insensitive;
UID matching is exact. There are no database migrations or changes to financial IDs.

Only Jakob is currently permitted at the Authentik gate and mapped to `kran`.
The current verified email and Authentik UID were read from the authoritative
existing user/confirmed email-device configuration, and are stored only in
`/srv/app-data/flat/flat.env` (0600). The mapping is not frontend configuration.
Old `flat_session` selections and `SESSION_SECRET` no longer authorize requests.
Expense `created_by` comes from verified identity; the selected payer/splits retain
their original financial meaning and may reference any existing roommate.

## Later onboarding

1. In Authentik, configure the intended existing person's actual email and complete
   the native verified email-code setup. Adding an email alone does not grant Flat
   access: its native policy and email flow must explicitly permit that exact user.
   Follow infra's `docs/authentik.md`: privileged gateway changes require an explicitly
   created expiring admin API token; no standing-token discovery or database writes.
2. Read that existing user's Authentik `uid` (the value emitted in `X-Authentik-Uid`,
   **not** the separate database `uuid`) via read-only framework inspection. Confirm
   their unique verified email and the matching confirmed EmailDevice. Never guess.
3. Add one mapping to the JSON array in private `FLAT_IDENTITY_MAP` in
   `/srv/app-data/flat/flat.env`, preserving the existing Jakob entry. Example only:

   ```dotenv
   FLAT_IDENTITY_MAP='[{"email":"owner@example.test","uid":"owner-authentik-uid","roommateId":"kran"},{"email":"roommate@example.test","uid":"roommate-authentik-uid","roommateId":"stadlmann"}]'
   ```

   Existing IDs are `kran`, `stadlmann`, `mitter`. Select the correct existing ID;
   never rename or recreate roommates, import expenses or reset balances. Keep one
   unique email/UID per roommate. Keep the env file mode 0600. Do not commit it.
4. Restart only `systemctl --user restart flat-web.service` on dev. Have the person
   sign in normally at the public URL and confirm the displayed roommate. No picker
   should appear. Mapping alone cannot bypass Authentik's native app allowlist.

## Expiry and acceptance

Caddy returns JSON 401 without Location for expired/anonymous `/api` requests;
normal page navigation retains Authentik's top-level login redirect. The frontend
keeps an unsaved form visible and offers **Erneut anmelden**. It never automatically
replays a mutation. Returning to the page discards the draft; check saved data before
submitting again, particularly if a multi-step receipt upload was interrupted.
Logout navigates to Authentik's native outpost sign-out endpoint.

Automated tests use isolated SQLite and synthetic identities only. Final manual
acceptance requires the user to sign in with their own email code, confirm Kran
without selection, inspect existing balances, and test expiry on a draft without
saving a synthetic production expense. Never extract OTPs or forge a live session.
