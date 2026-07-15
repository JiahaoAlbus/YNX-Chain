# YNX Finance handoff

## Source

- Branch: `codex/ecosystem-finance`
- Implementation commit: `91f62e7a509ae3ba9eed59d700056aacf9fd973d`
- Final handoff commit: branch `HEAD` reported to the integration task after push
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Finance`
- Base used: `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95`
- Declared shared baseline: `271197feb48fd362292fb2210887edf3109ce4f7`
- Base difference: one coordination-only commit,
  `51bed84 docs: define parallel ecosystem delivery objectives`; there was no
  rebase and no product/runtime change between the declared baseline and base.

## Changed paths

- `apps/finance/**`
- `internal/finance/**`
- `docs/handoffs/finance.md`

No acceptance state, long-term objective, root Makefile, central Gateway policy
or another product was edited.

## Delivered workflow

- Independent responsive Web/PWA and deployable `apps/finance/cmd/server`.
- Sign in with YNX Wallet request plus callback completion. Finance accepts only
  a Gateway-HMAC assertion bound to version 1, `ynx_6423-1`, `finance`, exact
  client/device/account/scopes, five-minute issue/expiry and one-time nonce.
  The account must be a valid native `ynx1...` address. Replays, tampering,
  wrong network/product/client, broad scopes and expired assertions fail closed.
- Thirty-minute product session stored in browser `sessionStorage`; logout
  revokes it. No recovery key, account secret or provider secret enters the Web
  bundle or persistent Finance state.
- Read-only YNXT balance, staked amount and owned activity from
  `ynx-explorerd`. Explorer account evidence is normalized and must match the
  Wallet-authorized account. Activity coverage is explicitly the latest 100
  indexed transactions filtered to the account; no historical-completeness or
  fiat-value claim is made.
- Pay receipts from the authenticated Pay API. Records are retained only when
  `account`, `signer`, `payer`, `buyer`, `merchant`, `seller`, `from` or `to`
  resolves to the authorized account. Transaction hashes and dispute URLs are
  kept as evidence links. An unavailable Pay source produces an unavailable
  state and no receipt placeholder.
- Account-scoped categories, budgets, recurring reminders, classifications,
  privacy settings, AI jobs and hash-independent audit records in atomic JSON
  persistence (`0600` file, temp-write plus rename). Creation requests use
  bounded idempotency keys; sessions are rate limited; bodies are strictly
  parsed and size bounded; cross-origin mutations fail closed.
- Source-bounded monthly/custom statements, JSON account export and CSV
  activity export. The statement states that opening balance is unavailable
  because indexed activity is bounded; it does not masquerade as a bank
  statement.
- Privacy toggles for Pay statement inclusion, AI activity context and alerts;
  source/anomaly alerts are informational and cannot freeze or reverse assets.
- Help, privacy and dispute links are runtime-validated absolute HTTP(S) URLs.
- Optional protocol surface is disabled. Its UI and API list the mandatory
  disclosure gate: counterparty, custody, contract, principal-loss risk, fee,
  liquidity risk, jurisdiction risk and signature boundary. Any future action
  remains a YNX Wallet review/signature, never a Finance signature.

## AI-native workflow

Supported draft kinds are `categorize`, `explain_fees`, `draft_budget`,
`detect_anomalies` and `explain_recurring`.

1. User enables the Finance privacy scope.
2. User selects exact owned indexed record IDs and sees the context class.
3. User grants per-request consent.
4. Finance checks provider/model availability and receives a resource/cost
   estimate from the permissioned YNX AI Gateway.
5. The Gateway NDJSON stream is persisted as bounded progress and can be
   cancelled. Provider errors remain failed jobs; there is no local canned
   fallback.
6. Result remains `ready` until explicit apply or reject. Categorization is
   revalidated against the job's owned IDs and existing categories. Budget
   drafts are revalidated against account categories, period and positive YNXT
   limits. No draft applies before review.
7. Provider/model, selected context class, record IDs, estimate, status,
   decision and timestamps remain in the account audit state.

The permission sent to the Gateway explicitly excludes transactions, transfers,
trades, borrowing, lending, staking, freezing and account-control changes.

## Truth and security boundaries

- This is not a bank, deposit account, custodian, broker, investment adviser,
  lender, credit/card product, insurer or yield product.
- No APY, return, fiat balance, card, credit, insurance, custody, leverage or
  unsupported cross-chain balance is generated or displayed.
- Balance/activity/Pay records are fetched at request time. Source failures and
  empty results remain visible; no synthetic public data is used.
- Browser test fixtures were local verification inputs only and are not bundled,
  committed, deployed or represented as public-chain evidence.
- Sessions are memory-only and intentionally require Wallet reauthorization
  after a service restart. Persistent account planning state survives restart.
- CSP restricts scripts/styles/connect targets to self; framing, camera,
  microphone, geolocation and browser payment permissions are disabled.

## Verification evidence

Passed on 2026-07-15 in the isolated Finance worktree:

- `npm test --prefix apps/finance`
  - 3/3 product contract, truthful-boundary and responsive/accessibility tests.
- `bash apps/finance/scripts/smoke.sh`
  - Finance Go tests, Node tests and exact server binary build passed.
- `go vet ./internal/finance ./apps/finance/cmd/server`
- `go test ./internal/finance ./apps/finance/cmd/server`
- `npm ci`
- `npm run hardhat:build`
- `npm run contracts:selectors`
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `git diff --check`

The first full `go test ./...` attempt failed because this new worktree did not
contain ignored Hardhat artifacts. After the documented local build and selector
generation, the complete test suite passed. Generated contracts, build info and
`node_modules` remain ignored and are not part of this branch.

Browser verification used the local server with local Explorer/Pay/AI fixtures:

- Desktop `1280x900`: Wallet callback completed, Explorer + Pay source badge
  became live, 18,420 YNXT balance, 3,200 staked YNXT, two owned transactions
  and one account-owned Pay receipt rendered with no horizontal overflow.
- Mobile `390x844`: signed-out and signed-in planning layouts had
  `scrollWidth == clientWidth`; bottom navigation, forms and risk copy remained
  reachable.
- Created category `Operations`, refreshed and confirmed persistence.
- Browser console contained no warnings or errors.

These screenshots were visually inspected during local Browser verification;
they are UI/runtime evidence, not public deployment or public-chain evidence.

## Platform/package evidence

- Exact runnable artifact: `go build ./apps/finance/cmd/server` (also exercised
  by `apps/finance/scripts/smoke.sh`).
- Web/PWA manifest and responsive desktop/mobile views are present.
- No public deployment, TLS ingress, mobile store package, production Wallet
  registration or production signing claim is made by this branch.

## Incomplete/external items

No in-scope Finance implementation item is intentionally left as a shell. The
following are central integration or external configuration, and remain false
until the integration task supplies evidence:

- Production/public deployment and DNS/TLS.
- Production Wallet/Gateway registration and secrets.
- Production Pay read credential and support/privacy/dispute URLs.
- Production Finance-scoped AI Gateway provider/quota.
- Complete historical account statements. The existing Explorer contract only
  exposes a latest-100 transaction window; the current product discloses this
  bound and never claims full history.

## Exact integration requests

1. Register Wallet product/client `finance` / `finance-web`, exact callback and
   sorted scopes `finance.ai.draft`, `finance.pay.read`,
   `finance.portfolio.read`, `finance.profile.write` in the central reviewed
   Wallet/Gateway registry.
2. Provision one minimum-32-byte Wallet assertion HMAC secret to Wallet Gateway
   and Finance through the deployment secret manager. Do not put it in the App,
   browser bundle, repository, logs or handoff.
3. Provision an account-readable Pay API credential and configure
   `YNX_PAY_URL`, `YNX_PAY_API_KEY`. The Pay endpoint must continue returning
   committed event evidence, including signer/merchant, amount, `txHash` and
   timestamp.
4. Register Finance-only AI Gateway routes `/v1/status`,
   `/v1/finance/estimate`, `/v1/finance/drafts:stream` with an exact draft-only
   policy and operator-controlled quota. No provider secret belongs in the Web
   client.
5. Supply reviewed support, privacy and dispute URLs and configure TLS ingress,
   allowed origins, state volume backup/restore, health probe and rollback for
   `ynx-finance`.
6. Add a future account-scoped, cursor-paginated Explorer activity endpoint if
   complete historical statements are to be claimed. Until then retain the
   current visible latest-100 coverage disclosure.
