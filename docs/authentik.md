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

The explicitly authorized 2026-09-21 onboarding is live:

| Person | Email | Authentik PK / UUID | Existing roommate |
| --- | --- | --- | --- |
| Jakob | existing administrator identity | 21 / `af9391a4-69b2-4ed3-94a4-c14859713e77` | `kran` |
| Stadlmann | `stadlmair.j1kob@gmail.com` | 56 / `116fbdde-fc2c-4ecc-914a-aa46517daa23` | `stadlmann` |
| Mitter | `moritzmitter7@gmail.com` | 57 / `415ef168-600f-4137-8fb0-2e13deb5edba` | `mitter` |

Flat gateway authorization now uses the native Authentik **WG** group
(`e4d852dd-e25c-4ea0-9663-dacbe3e97a08`) with a separate active-user policy, both
required in `all` mode. Jakob, Stadlmann and Mitter are current members. The two
ordinary accounts have WG membership and no administrator or role grants.
Membership grants gateway access; it does not create a backend roommate mapping.

The repaired shared email branch uses the pinned safe WG enrollment scope instead
of an exact per-person list. Ordinary users must have only WG as their direct group,
no roles or unsafe inherited privileges, a unique email, and one matching confirmed
native EmailDevice at the existing email-code stage. Devices 18 and 19 are retained.
No self-registration or enrollment flow was added. Native OTP/device proof is still
required; eligibility and configured confirmation do not prove a human sign-in.

Other app gates were preserved from the fresh repair baseline. WG currently also
passes Freundebuch due to a separate manual binding; Stadlmann and Mitter fail
Sitzplan, Wizard, Jungschar, Immich and Pages CMS. Viktoria's original Sitzplan/email
policy code remains untouched; her separate group assignment currently makes those
policies deny her. Jakob's administrator and independent recovery remain intact.

All three verified email/UID mappings are stored only in
`/srv/app-data/flat/flat.env` (0600), using authoritative Authentik `User.uid`, not
UUID. The existing `kran` entry and every other env byte were preserved. Only the
local user `flat-web.service` was restarted; no roommate or financial record was
changed. The mapping is not frontend configuration.
Old `flat_session` selections and `SESSION_SECRET` no longer authorize requests.
Expense `created_by` comes from verified identity; the selected payer/splits retain
their original financial meaning and may reference any existing roommate.

## Later onboarding

1. In Authentik, configure the intended existing person's actual email and complete
   the native verified email-code setup. Adding an email alone does not grant Flat
   access: an administrator must enroll its native device and grant WG membership.
   The safe WG email scope and native OTP proof must both pass; no public self-enrollment
   is enabled.
   Follow infra's `docs/authentik.md`: privileged gateway changes require an explicitly
   created expiring admin API token; no standing-token discovery or database writes.
2. Read that existing user's Authentik `uid` (the value emitted in `X-Authentik-Uid`,
   **not** the separate database `uuid`) from the authoritative API record and verify
   it with read-only framework inspection. Confirm
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
   should appear. Mapping alone cannot bypass Authentik's native WG and active-user bindings.
   Conversely, a WG member without a configured email+UID mapping is denied by Flat.

## Expiry and acceptance

Caddy returns JSON 401 without Location for expired/anonymous `/api` requests;
normal page navigation retains Authentik's top-level login redirect. The frontend
keeps an unsaved form visible and offers **Erneut anmelden**. It never automatically
replays a mutation. Returning to the page discards the draft; check saved data before
submitting again, particularly if a multi-step receipt upload was interrupted.
Logout navigates to Authentik's native outpost sign-out endpoint.

Automated tests use isolated SQLite and synthetic identities only. Final manual
acceptance requires the user to sign in with their own email code, confirm their mapped roommate
without selection (Stadlmann and Mitter must see their own respective roommates), inspect existing balances, and test expiry on a draft without
saving a synthetic production expense. Never extract OTPs or forge a live session.

Infra's scoped verifier is `sudo python3 scripts/authentik-app-policy --flat-only`
on agency. It verifies the native WG and active-user bindings, safe enrollment scope,
unchanged native proof/throttle and complete current application matrix. It preserves
historical identity/device receipts as audit evidence rather than app allowlists.
Repair evidence is `/home/jacksn/.hermes/cache/flat-wg-repair/result.json` on dev.
The repair changes no Flat environment bytes, mappings, service state, database,
financial IDs or UI. Each person's real OTP sign-in and displayed-roommate acceptance
remain manual; no code was requested/retrieved and no live session was forged.
The task token remains active for Hermes's independent verification and revocation.
