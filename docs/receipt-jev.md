# Receipt decision stage (pending coordinator review)

Baseline: `42d539b`. Production defaults to legacy; no deployment, credential
installation, migration, or expense correction is included in this change.

`FLAT_RECEIPT_DECISION_PROVIDER=legacy` (or unset) retains Sol low extraction and
assignment. `jev` uses the same image/PDF extraction transport, with bounded
embedded PDF text, but requests only merchant/date, printed total, labels,
generic names, quantities, signed cents and warnings. It does not run the old
category/rule/split prompt. Missing printed total, invalid extraction or a signed
sum mismatch fails before Jev. This stricter path supports at most 100 positions.

Jev receives labels, generic names and current rule descriptions, closed category
choices and rule IDs. No prices, roommate shares, document images or saved
financial history are sent to Jev. Local code validates the full response shape,
exact answer keys/count, choice membership and probability keys/ranges. The
recorded `jev-1.13.0` response version is pinned even though requests use
`jev-latest`; a changed response model requires review. Literal item matches beat
semantic item choices, which beat exact category fallback. A selected category
rule inconsistent with the category fails. Allocations and signed cent sums are
computed locally. Equal prose with near-equal positive percentages (e.g.
33/33/34) uses equal weights; exclusive and deliberately unequal rules retain
their configured shares. Learning still runs afterward with existing explicit
rule precedence and saved-correction evidence requirements.

Human-adjudicated aliases are SPAR BIO-TOMA.BA200G → Tomatenmark and SPAR BIO
VK.TORRI → Vollkornnudeln. They identify products only. The tomato rule can apply
locally; pasta ownership remains subject to current rules or saved learning.
Tests establish a 100% Kran pasta correction through two independently saved
synthetic receipts in isolated SQLite. No historical row is rewritten and no
new permanent allocation preference is installed.

Every Jev analysis asks the user to review categories and assignments before saving; provider confidence scores are not calibrated.
Sonstiges, unmatched rules and confidence below 0.8 add a position warning; 0.8
is a review heuristic, not an accuracy guarantee. Timeout, outage, schema doubt,
wrong model or unavailable transport fail closed (502/504) without an
automatic legacy retry. Upstream 401 never becomes a Flat login failure.
Operators may explicitly select legacy before a later user-initiated analysis;
there is no hidden fallback within a request.

## Durable app credential setup (operator action still required)

OpenClaw's protected `TYPESAFE_API_KEY` remains in its protected store. Do not
resolve, retrieve, copy, export or persist that value or a command-lifetime
sentinel. Protected-store docs/setup provide no supported durable binding for an
external Bun service. Temporary Gateway benchmark egress is a separate capability,
not a production credential installation.

Production now supports a **separately user-provisioned TypeSafe app credential**.
The user must obtain this independent credential directly through their provider
account; never use the protected-store value as its source. No actual credential
file has been created or read during implementation.

Required configuration in the existing private Flat environment file:

```dotenv
FLAT_RECEIPT_DECISION_PROVIDER=jev
FLAT_TYPESAFE_API_KEY_FILE=/srv/app-data/flat/typesafe.key
```

Keep the provider unset or `legacy` until provisioning and deployment are approved.
Legacy startup does not read the credential path/file. When Jev is selected,
`server/index.ts` calls `receiptDecisionConfig()` before opening the database or
serving requests. Missing/invalid configuration fails startup before any paid
extraction. A valid file creates the concrete default-fetch transport; no custom
bootstrap adapter is needed. The injectable `JevTransport` remains available for
isolated tests and coordinator-run protected benchmark calls.

The file must be an absolute path to a regular, non-symlink file, readable by the
Flat service user, with no group/other permission bits (use 0600). Maximum size:
4096 bytes. Content: one bearer token, optionally ending with a newline; at least
16 characters, with only bearer-token ASCII characters. Blank/multiline values,
secret references, recognizable sentinel/placeholder markers, directories,
symlinks and oversized files are rejected with a generic error. File reads are
bounded even if the file grows. The token is loaded only on Jev startup and held
in the transport closure; rotating it requires a scoped service restart. It is
never placed in command arguments, logs, responses or request bodies.

After explicit deployment approval, the operator can provision the **independent
app key** in their own interactive terminal as the Flat service user. This example
masks input, refuses to overwrite an existing file and creates mode 0600. It must
not be run with an OpenClaw secret reference/sentinel or a retrieved store value:

```sh
python3 - <<'PYKEY'
import getpass, os
key = getpass.getpass("Separately provisioned Flat TypeSafe app key: ").strip()
if not key:
    raise SystemExit("No key entered; no file created")
fd = os.open("/srv/app-data/flat/typesafe.key", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as output:
    output.write(key + "\n")
PYKEY
```

Then add the two configuration lines above to `/srv/app-data/flat/flat.env`,
preserving all existing configuration/identity mappings and private permissions.
Once the reviewed backend is deployed, run only
`systemctl --user restart flat-web.service`. Check readiness and perform a
synthetic analysis without saving an expense. Confirm correct categories,
unknown-product warnings, totals, and provider failure handling. No real user
login acceptance is implied. To revert the decision provider, set `legacy` and
restart only that service; no data migration or expense rewrite is needed.

The production transport uses only
`https://api.typesafe.ai/v1/systemone`, POST JSON, `redirect: error`,
`credentials: omit`, the supplied AbortSignal and explicit TLS certificate
verification. It disables verbose fetch logging and refuses startup with
`NODE_TLS_REJECT_UNAUTHORIZED=0`. There is no configurable endpoint, redirect
following, credential-store lookup or environment bearer-key fallback. Local
code retains the 15-second whole-call/body deadline, 500 KB request and 1 MB
response caps, final-URL checks and generic upstream errors. Injected transport
remains a trusted capability and must enforce equivalent egress protections.

Remaining actions are independent app-key provisioning and deployment. The user has authorized the switch; no further deployment approval is needed. No current live Flat Jev operation is claimed.

## Evidence and validation scope

Local benchmark source: `/home/jacksn/.openclaw/workspace/.tmp/openclaw-spikes/receipt-decisions`.
The recorded Jev apple miss (correct Obst, rule none) motivates exact category
fallback. Original APFELSTGELSTARTA and held-out label variants independently test
that local fallback with injected decisions; they do not measure fresh Jev
accuracy. Historical 84/90 is saved-category agreement, not human ground truth.
The parent subsequently ran the reviewed module with synthetic lines through
Gateway protected egress at `/tmp/flat-jev-control/provider-proof`: 1.008 seconds,
valid protocol, but APFELSTGELSTARTA returned Sonstiges/none (category confidence
0.30), whereas the genuinely unknown SKU returned Sonstiges at 0.99. This newer
failure cannot be repaired by the old correct-Obst fallback.

Revised questions explicitly identify their input label and describe general
German/Austrian till-label concatenation, suffix abbreviations and whole-product
semantics. Descriptive category criteria distinguish fresh fruit from fruit juice,
yogurt and pastry, and retain Sonstiges for opaque SKUs. No literal apple-label
category mapping was added. New tests ensure even that label remains Sonstiges
when the provider says so. Mocked decisions verify transport, warnings and local
logic only; improved model accuracy awaits the parent's new provider run.

Regression coverage includes extraction-only schema, signed sums, unchanged
amounts, item/category precedence, unknown SKU review, nuts versus vegetables,
corrected identities, equal signed coupon/deposit allocation, saved learning,
invalid/oversized responses, stalled body/transport, and provider 401 → 502 with
no draft or expense write. Normal auth/PDF/unit/backend/E2E checks remain required.
Builds and browser reports must stay outside the live checkout's `dist`.

Review before commit/push/deploy. Any eventual commit must include:

    Co-authored-by: jackstar12 <62219658+jackstar12@users.noreply.github.com>

## Implementation validation — 2026-10-05

Staging: `/tmp/flat-jev-20261005-stage` (no production env/data copied).
Typecheck and staged build passed. Vitest: 35 passed; Bun backend: 81 passed,
including 26 new decision-stage tests. Playwright: 74 passed, two opt-in live
inference tests skipped; included canonical Caddy auth integration with synthetic
identities and temporary SQLite. Browser log: staging `e2e-run.log`.
Both saved contrast Jev responses passed an offline adapter replay with synthetic
amounts/shares; the recorded apple category fallback passed. No fresh provider
accuracy or durable protected egress acceptance is established.

The six changed files matched staging; hashes are recorded in staging
`review-source-sha256.json`. The live service retained PID 1509914 and its
`dist/index.html` SHA-256 stayed
`bc9358fb1f748924b7a7f7c9bce37e8acf29e529b4da2b4be5d2859a93155abb`.
No commit, push, deployment, service restart, production expense write, credential
retrieval or persistent credential configuration was performed.


## Incremental review update

The follow-up changes only decision guidance, file-backed transport/configuration,
focused tests and this setup documentation. The earlier 74-pass browser run remains
applicable to unchanged UI/auth behavior; it was not repeated for this increment.
Temporary protected Gateway protocol proof and separately provisioned durable app
credentials are distinct: neither establishes the other's setup or acceptance.

Incremental typecheck passed. The focused decision, inference/PDF and app/auth
backend suite passed 86 tests, including seven new configuration/guidance tests.
Only temporary synthetic credential files were used. Results:
`/tmp/flat-jev-20261005-stage/incremental-backend.log`.
Live PID 1509914 and the index hash above remained unchanged. Independent app-key
provisioning, the parent provider rerun and deployment approval remain pending.


## Parent provider follow-up and PDF precedence adjustment

The parent's revised raw-label test still classified APFELSTGELSTARTA incorrectly
as Brot & Gebäck, with a review warning. Three held-out apple labels were correct
and the opaque SKU remained unknown. The compressed-label limitation remains;
there is no hardcoded apple-category override or claim that mocked fallback tests
establish classification accuracy.

The parent's actual JPEG → extraction → Jev run passed: 934 cents, date
2026-10-05, all four expected categories/rules, in a reported 14.152 seconds.
Extraction supplied Äpfel Elstar before Jev selected Obst. Evidence:
`/tmp/flat-jev-control/provider-proof/full-extraction.json` and `full-analysis.json`.
This is an isolated live-provider pipeline test, not deployed Flat acceptance.

The actual PDF2 run failed safely before Jev: printed total 935 cents versus
199 + 224 + 351 + 164 = 938 cents. The extraction explicitly acknowledged embedded
PDF text of 161 cents for yogurt but preferred a blurry image reading of 164.
Evidence: `/tmp/flat-jev-control/provider-proof/full-extraction-pdf2.json`.
The extraction-only prompt now explicitly prefers coherent embedded PDF text for
labels, prices, date and total over ambiguous rendered glyphs, uses images for
layout/alignment, and requires a signed-sum cross-check. It forbids inventing
prices, balancing items or arithmetic corrections to force a total. Unresolved
conflicts remain warnings and fail the existing local total check. No backend
extraction redesign, retry or fallback was added.

The focused regression checks the prompt delivered to extraction and verifies
that the 938/935 conflict never reaches Jev or gets repaired locally, while the
supported 161-cent variant preserves every amount and totals 935. This does not
prove the model follows the guidance; the parent's actual PDF2 rerun is pending.
The app credential is still absent; no deployment, credential, service-config or
production financial changes have been made.

For this narrow prompt increment, typecheck and 63 focused decision/inference
(including PDF) tests passed. Log: staging `pdf-precedence-tests.log`. Unaffected
browser tests were not repeated. Changes remain uncommitted for parent review.

## Final coordinator review

The actual PDF2 rerun passed after the precedence adjustment: 935 cents,
2026-09-21, with amounts 199/224/351/161 unchanged and all four expected
categories/rules, in 12.782 seconds. Together with the 934-cent JPEG result above,
this verifies two isolated extraction-to-Jev provider calls, not deployed acceptance.
The raw compressed-label limitation still applies; normal image extraction produced
the correct normalized apple identity. No automatic expense save was introduced.

Final review also rejects the actual `oc-sent-v2...end` sentinel format in app
credential files and keeps the user-facing review reminder free of provider jargon.
The TypeSafe app-key file is still absent. Legacy remains active; production
configuration, service, assets and saved finances are unchanged.

Final coordinator checks: typecheck and 87 decision/inference/app-backend tests passed (`final-backend.log` in staging). The prior 35 frontend/unit tests, database suite, staged build and 74 browser tests remain applicable; no UI/auth or schema change was made in the follow-ups.
