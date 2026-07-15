# YNX Exchange handoff

## Branch and baseline

- Branch: `codex/ecosystem-exchange`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Exchange`
- Started from repository `main` commit `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95`.
- The coordination document names older baseline `271197feb48fd362292fb2210887edf3109ce4f7`; this task intentionally starts from the current launch commit and did not rebase or merge another product branch.
- Final commit: the branch tip containing this handoff; the exact immutable hash is supplied in the completion message.

## Product truth boundary

This is a YNX-owned deterministic testnet venue. It is not an exchange listing, a production custody venue, or evidence of public users, liquidity, volume, counterparties, market depth, or third-party prices. The only order-book rows are persisted open user orders, and the only last-price/chart/trade rows are actual matches made by this engine.

`YUSD_TEST` is a venue-only deterministic quote credit. It is not a token or stablecoin and cannot be deposited or withdrawn. Its operator allocation endpoint is API-key protected, idempotent and audited. Cross-chain asset routes are fail-closed. Native deposit is enabled only when both the YNX Indexer URL and an exact native custody address are configured. Native withdrawal is review-only: funds are reserved with exact fee and Wallet authorization, while broadcast remains explicitly unavailable until an operator adapter and proof are integrated.

## Changed paths

- `apps/exchange/**`: independent Web/pro terminal, responsive mobile structure, Go daemon entrypoint, browser/unit/smoke tests, operator README.
- `internal/exchangeproduct/**`: domain model, integrity-protected atomic JSON persistence, auth, chain adapter, balances, matching, deposits, withdrawal review, fees, security, support, AI audit workflow and HTTP API.
- `docs/handoffs/exchange.md`: this handoff only.

No long-term goal, central acceptance state, root `Makefile`, central Gateway policy, or other product path was modified.

## Architecture

1. `apps/exchange/server` serves the static terminal and mounts the product-local API under `/api` with CSP, referrer and permissions policy headers.
2. Sign in uses a strict temporary `ynxwallet://authorize` adapter. The five-minute one-use challenge binds native account, device, `ynx.exchange` client, exact callback, sorted least-privilege scopes, chain `ynx_6423-1` and purpose. Server-side Ed25519 proof verification creates an opaque hashed session; no Wallet or recovery private key crosses into Exchange.
3. Each place/cancel/withdrawal-review request has a canonical action payload and requires a fresh Wallet signature. HTTP request parsing rejects unknown fields and oversized/multiple JSON bodies.
4. The ledger uses fixed integer six-decimal venue values. Buy orders reserve exact limit quote plus maximum taker fee; sells reserve base amount. The synchronized price-time engine performs atomic matching, actual partial/full fills, exact maker/taker fee records, reserve release and self-trade rejection.
5. Every state mutation writes a complete integrity hash and fsyncs an owner-only temporary file before atomic rename. Startup rejects tampered state. Idempotency records bind action, payload digest and object ID.
6. The chain adapter reads committed transfer evidence from `ynx-indexerd` `/txs/{hash}` and current height from `/ynx/overview`, calculates confirmations, validates exact custody destination, and maps the chain API's integer YNXT amount into the venue's six-decimal representation.
7. AI records bounded selected context, permission, Gateway/provider/model status, estimated resource cost, user request and audit event. With no configured provider it returns `provider_unavailable`; no canned response is substituted. Retry, cancel, reject and context deletion are auditable. AI never calls order, cancel, withdrawal or security mutation methods.

## Implemented workflow coverage

- Sign in with YNX Wallet challenge/session and replay rejection.
- Market and real owned-order book; asset/network selection and truthful empty/loading/failure retry states.
- YNX Testnet deposit observation, pending confirmations, refresh, confirmed credit, duplicate transaction rejection and restart recovery.
- Native withdrawal review with exact fee, receive amount, balance reservation, Wallet signature and security lock; no false broadcast/sent state.
- Limit buy/sell form; open, partially filled, filled, cancelled and rejected lifecycle; trade and fee history.
- Available/reserved balances, security settings, support cases, owned audit trail.
- AI market explanation, owned-trade summary, risk explanation and order-draft request types within permission/provider failure boundaries.
- Desktop professional terminal plus mobile stacked layout, keyboard skip navigation, labeled controls, focus visibility, reduced motion, live status and no horizontal mobile overflow.

## Verification

Passing:

- `go test -race ./internal/exchangeproduct`
- `go test ./internal/exchangeproduct ./apps/exchange/server`
- `npm --prefix apps/exchange test`
- `npm --prefix apps/exchange run test:browser` (Playwright with installed Google Chrome, desktop 1440x900 and mobile 390x844)
- `npm --prefix apps/exchange run smoke`

Browser evidence is generated outside Git at:

- `tmp/exchange-browser-evidence/desktop.png`
- `tmp/exchange-browser-evidence/mobile.png`

Repository-wide `GOMAXPROCS=2 go test ./...` was run. All Exchange tests passed, but the existing unrelated `internal/bftgateway` and `internal/consensus` IDE tests failed because `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json` is absent from this baseline worktree. This branch does not own or alter that artifact path.

Final pre-push check results are appended before commit if any status changes.

Not run in this product branch: root `make test`, `GOMAXPROCS=2 make preflight`, `make objective-state-check`, public deployment checks, native package installation and cold-launch checks. The root integrated-release gates belong to the main integration authority and the external deployment/package inputs do not exist here. The direct repository-wide Go command above was run instead and its unrelated missing-artifact failures are recorded exactly.

## Security boundaries

- Admin key, custody address, Indexer URL and state path are environment input only; no real secret or `.env` is committed.
- Sessions store only token hashes and Wallet public keys and are scoped/expiring; browser storage is session-only.
- Custody and chain evidence are never inferred. Missing dependencies disable the route.
- Withdrawal review is not withdrawal broadcast. Operator broadcast, transaction hash and confirmation proof remain external work.
- Cross-chain remains disabled until approved bridge adapter, relayer custody, exact asset route and external proof all exist.
- The temporary Wallet adapter must not be marketed as Task 1's final shared Wallet protocol.
- The product has no production deployment, signed native package, audit or public venue claim.

## Integration requests for the main task

1. Review and replace the temporary Wallet adapter with Task 1's accepted shared protocol package without weakening challenge/action bindings.
2. Register the exact `ynx.exchange` client, callback and scopes in central Gateway policy after security review; this branch intentionally does not edit central policy.
3. Provide operator-approved custody address, Indexer endpoint, withdrawal broadcast adapter and proof contract before enabling any runtime route beyond review.
4. Connect a product-scoped YNX AI Gateway client/provider only after model, quota, streaming/cancel and retention policies are accepted. Provider secrets must remain server-side.
5. Decide deployment/package targets and execute committed-source health, rollback and public TLS proof in the integration thread. No deployment is claimed here.

## Remaining external/integration gaps

- Accepted Task 1 Wallet protocol branch and central client registry.
- Operator custody and withdrawal-broadcast implementation/proof.
- Configured provider-backed AI Gateway generation; current behavior is an honest unavailable state.
- Production deployment, native mobile packaging, independent security audit and any regulatory/custody approval.

These gaps do not create fake local success states; their related actions stay unavailable or review-only.
