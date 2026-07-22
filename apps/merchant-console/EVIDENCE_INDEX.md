# Evidence index

## Recovery

- Recovery baseline: `ffb528b4971b5849ffb151a018263daf5c0e2cb0` from `codex/ecosystem-pay`.
- Restored uncommitted Merchant Console files and the coupled `internal/payproduct` Merchant/RBAC/Webhook/Settlement implementation from `/Users/huangjiahao/Desktop/YNX Chain Pay` without modifying that source worktree.
- Target branch/worktree: `codex/final-merchant-console`, `05-merchant-console`.

## Local verification (2026-07-22, Apple M2, darwin/arm64)

- `npm ci && npm run check`: 7/7 tests passed; production static bundle built.
- `go test ./internal/payproduct/...`: passed.
- RBAC fuzz: 40,768 executions in 2 seconds after 108 seed cases; passed.
- Webhook fuzz: 8,358 executions in 3 seconds after seed coverage; passed.
- Settlement fuzz: 14,102 executions in 3 seconds after seed coverage; passed.
- `TestMerchantRBACWebhookSettlementSoak`: 100,000 iterations; passed within the normal Go suite.
- Fault test: provider failure leaves invoice pending and membership permissions fail closed.
- Microbenchmarks: RBAC 14.52 ns/op, webhook signing material 280.2 ns/op, settlement evidence validation 16.60 ns/op. These are component benchmarks, not end-to-end capacity claims.

## Provider, capital and migration verification (2026-07-22)

- Provider catalog covers all nine required categories and requires source/version/environment/capability metadata.
- Provider tests prove raw credential-shaped input rejection, server-side evidence-only health, persisted unavailable state, cross-state disable, and no success without an adapter.
- Capital tests prove all 14 services carry Provider/cost/risk/term/non-guarantee disclosure and that missing cost/reserve/net values remain null/unavailable.
- Snapshot v1 migrates to v2 with an initialized Provider map; unsupported future versions fail closed.
- Re-run fuzz totals: RBAC 42,125 executions, Webhook 17,790 executions, Settlement 50,809 executions after seed coverage; all passed.
- Frontend CycloneDX SBOM and path-sanitized Go dependency inventory are recorded under `artifacts/sbom/`.

## Recovery drill (source `53adf12dde18c4e6d0ca3602a528d3efe8c19aef`)

- Built the daemon and independent recovery CLI from the exact source commit.
- Started and gracefully stopped the service against an ephemeral integrity-protected snapshot; the service operation lock was released.
- Created and independently verified a non-overwriting backup archive.
- Changed the current store byte representation to produce a different valid SHA-256, then restored with that exact confirmation.
- Restored SHA-256 matched the backup source SHA-256; automatic rollback SHA-256 matched the pre-restore state.
- Machine evidence: `evidence/backup-restore-drill.json` (SHA-256 `eab7eee06310e9519d2d7f5945ce977a0e8a6a5ad5e95aff906e2a5cdfa6e045`, 3,024 bytes).
- Scope limitation: 427-byte empty local snapshot. This proves the workflow and guards, not production-size RTO/RPO.

## Observability verification

- HTTP responses and structured JSON logs correlate request and trace IDs; public errors add a supportable error ID and stable code.
- Tests prove logs omit authorization material and responses sanitize provider bodies, stack details and server paths.
- Central Pay and AI calls propagate request ID and W3C trace context.
- The process-local metrics snapshot is protected by a constant-time monitor-key check, fails closed when unconfigured, uses bounded route templates/status/duration buckets, and excludes query strings, headers and keys.
- `go test -race ./internal/payproduct`, `go test ./internal/payproduct/...` and `go vet ./internal/payproduct/...` passed after these changes.
- Post-change fuzz rerun passed: RBAC 38,756 executions, Webhook 13,485 executions and Settlement 30,818 executions after baseline coverage.
- Scope limitation: no OpenTelemetry collector, durable exporter, alert delivery, staging dashboard or measured SLO is claimed.

## Focused UI, RTL and accessibility verification

- Current production bundle loaded over local HTTP in the in-app Chromium browser at 1280x720 desktop and 390x844 mobile.
- Direct DOM/style observations: one main landmark and H1, valid `#main` skip target, no page-level horizontal overflow, Arabic `lang=ar` and `dir=rtl`, localized Arabic skip/sign-in/privacy text, and 46px visible form controls.
- Changing Arabic to Simplified Chinese retained focus on the locale control and exposed a 3px focus outline; skip text and document direction changed with the locale.
- `npm run check` passed 10/10 tests and rebuilt the production bundle; `npm audit --omit=dev` reported zero vulnerabilities.
- Scope limitation: this is not a WCAG conformance claim. Authenticated views retain untranslated English copy and the full screen-reader/keyboard/zoom/rules/screenshot matrix remains open.

## API and reconciliation compatibility

- `API_CONTRACT.md` records every current route, its authority class, RBAC permission, success status and non-execution boundary.
- Reconciliation CSV now declares schema version 1 and is encoded before headers are committed so serialization failure cannot masquerade as a successful download.
- The golden test fixes the ten-column order, RFC3339 timestamps, empty pending evidence and authoritative committed transaction/block fields.

## Webhook destination containment

- Configuration rejects non-HTTPS, userinfo, fragments, non-443 ports, local/internal names and all IP literals.
- Delivery rejects loopback, private, link-local, carrier-grade NAT, benchmark, documentation IPv6 and mixed public/private DNS answers.
- Production dialing disables environment proxies, dials only an address from the validated answer, retains TLS hostname verification and never follows redirects.
- Fault test proves a metadata-address DNS rebinding result makes zero transport calls and persists a retrying attempt rather than success.
- Destination-syntax fuzz passed 41,606 executions in two seconds after seven seed cases, adding 83 coverage-interesting inputs.

## Truthful release state

See `product-release.json`. No public URL, public Testnet transaction, hosted download, central integration or production signature is claimed.
