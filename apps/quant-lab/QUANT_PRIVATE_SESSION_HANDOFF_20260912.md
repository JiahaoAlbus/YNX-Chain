# Quant private account — owner source candidate

## Compatibility continuation — 2026-09-12

The earlier 9dfe7809 package is superseded, NOT deployed. Fresh host reads found published source 443286487e057d78cb6b1a686d14bb37be8b3c23 contains research schedules, Sharpe/volatility/equity curves, Finance readonly integration, Exchange business mandate v2 and raw-state integrity compatibility absent from the initial owner baseline. These are now selectively merged in Quant paths, preserving tenant/idempotency/PG/private-proof work. Exact unchanged readintegration files were inherited separately at 23171a177030b9440fa34bc05148f2fbd213bdd3; existing nativewallet files are unmodified. Complete provenance is runtime-dependency-provenance.json, embedded in subsequent bundle manifests.

The current private Web consumer is a7dad7ec1bc7c06577978bdd5fea8dc9c7a248a9/tree acf17fed8866d00a3c0876ec51af020da0c9e506: ESM 223235B/SHA256 16b0d677ec21e84b5ce425138f175c37e1ac6d319db7fe5a85926b276dccd336. Shared restore now owns pending nonce/state/expiry; the product no longer reads protocol storage. Factory and Gateway adapter share one module. Standard c97 bytes remain unchanged. Offline protocol tests use the official frozen 9840 kernel with the new a7dad client/registry; they do not prove real approval.

Public guest research is stateless and returns measured backtest/equity/Sharpe results. Public snapshots never create tenants or expose the old workspace. Existing public write guards remain: XFF/proxy loopback cannot authorize Paper or schedules. Local owner workspaces retain saved strategies, research-only schedules, durable simulated Paper and idempotency. Public quant:account private session scope does not grant mandate/Paper authority. No fake funded public account is displayed.

Actual target/rollback baseline: evidence/quant-live-443286-readonly-baseline-20260912.json. Shared /opt/ynx-quant/current is referenced by another Exchange service and MUST NOT change. Only a Quant-specific ExecStart/WorkingDirectory drop-in may target the immutable release; preserve shared env, all state and Caddy. Filesystem storage remains single-writer; /api/ready stays honestly 503 until PostgreSQL is independently configured/verified. Rollback restores runtime configuration only, never a stale user-state snapshot.

Compatibility gates: Go race readintegration/productsessionv2/quantlab/server PASS; 19 Node tests; 16 Standard Chrome provider fixtures; 6 private Chrome tests; 3 offline official-kernel tests; 4 local Go browser tests; two-user/two-process 12-request idempotency/restart PASS. Real approval/signature/transaction/installed remain false. No deployment was performed by this compatibility checkpoint.

## Earlier checkpoint history (superseded by the above where different)

Worktree: `08-quant-flow-20260912`; branch: `codex/quant-financial-flow-20260912`.
This continues the pushed Wallet/Portfolio/Paper checkpoint `9b22a41c206e3cfca7f88b1aece11386df7de7e1`. It is not a public, installed, approved, signed or trading completion.

## Exact shared dependencies

- Standard Wallet remains `c97f85e9ae4d4580b99860c51738e6040ca9ca18`, tree `28a660bbe1451f0d5e20d6eb08da17eef0970d77`. Standalone artifact `vendor/standard-wallet-browser-c97f85e9.mjs`, 22,417 bytes, SHA256 `b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43`.
- Private browser SDK: `9840ef871165eb523c4e7a3d48964dd25f8dee8e`, tree `4b3d86ea4bf98481a9448c694eb022b33cd36679`. Both factory and Gateway adapter come from the SAME exact standalone module, `vendor/product-session-browser-9840ef87.mjs`, 214,746 bytes, SHA256 `5dc94d97925e4c0271c8c45255e0e409f257258e4e621f71fda26c4e2407a6e0`. Registry: 7,546 bytes, SHA256 `85c6995eddfbc175efaac01dbad31a4f5ef8878aab91613da2d689ef79921ab3`.
- Shared Go verifier: `0b3761f903ffd5dee6367e49c613cfd8752d7562`, inherited byte-for-byte with `cherry-pick -x` at `ea7dbca209c9f9e2f0d79b70d3bd9946fa57d89c`. The five `internal/productsessionv2/**` files are unmodified; no Quant signature/verifier protocol was created.

## Product behavior

`web/private-session.js` is a separate optional private-account controller. Standard Wallet, its fixed-block Portfolio reads and the independently persisted Paper tenant are unchanged by private failure or sign-out.

Fresh guest loads do not create private device keys or start a login. Explicit Sign in calls SDK `beginExplicit()`, persists the request before presenting its exact `route.url` as a user-click link, and labels installation **unverified**. It never automatically navigates, creates a popup/iframe, infers a native handler from an EVM provider, or calls Wallet account/sign/transaction methods. The explicit SDK link has not been clicked in this work. No native handler has been proved.

The canonical authority is fixed to `https://wallet-auth.ynxweb4.com`. SDK 9840ef87 namespaces keys/state by authority and keeps legacy/other-authority records untouched. The product's marker only opts into silent recovery; it does not authenticate. Exact subset `['quant:account']` is requested, not all registered mandate permissions. Returning to `/wallet-auth/callback` passes the COMPLETE URL to `handleReturn`. Asset URLs are root-relative: the old relative URLs broke callback-page script loading and were corrected.

Recovery re-introspects stored sessions via SDK `restore`. Pending-only state is preserved as `awaiting-return` rather than initiating a replacement request: nonce/state survive refresh or another tab until callback/new explicit attempt/rejection/expiry. A successfully processed approve/reject callback is removed from the address bar using same-origin `history.replaceState` (no navigation); refresh restores the stored session rather than replaying a one-time callback. A callback path without a query restores normally. Sign-out calls SDK `disconnect`; Retry calls `retryDetected`, preserving an unconfirmed revocation target. Pagehide/network/operation revisions prevent stale UI or account responses from reviving prior state. No session/key is exported, logged or manually migrated.

## Server/API contract

Enable with **only** `YNX_QUANT_PRIVATE_SESSION_V2_ENABLED=1` on the source-bound `apps/quant-lab/server` runtime. Default is unavailable. No configurable client-provided authority, origin, callback or scopes are accepted. CSP permits private connections only to the fixed authority in addition to self; frames remain disabled.

`POST /api/v1/wallet/private-account`, body exactly `{}`, requires the existing browser tenant header and `X-YNX-Product-Session-Proof-V2`. Each UI request calls SDK `createIntrospectionProof(['quant:account'])` afresh. The server independently chooses that scope and invokes the unchanged Go verifier, which submits canonical `{requiredScopes:['quant:account']}` to `/v2/product-sessions/introspect`. This body is NOT the product business body. No proof/decision cache or automatic replay is added. The shared authority must reject consumed proofs.

Registered binding: product `quant`, client `ynx-quant-v1`, application `com.ynxweb4.quant.web`, platform `web`, origin `https://quant.ynxweb4.com`, callback `https://quant.ynxweb4.com/wallet-auth/callback`, null bundle/package, chain `ynx_6423-1`.

The read-only result exposes verified native account, session binding, expiry and authority, explicitly `nativeExecutionEnabled=false`, `paperWorkspaceLinked=false`. It grants no write to the Paper tenant. This single read-only POST is exempted from the local-Paper mutation guard and protected by shared V2 authorization instead. Existing native/strategy write guards remain unchanged.

## Real remaining execution boundary

`/v1/testnet/mandates` and `/v1/testnet/orders` still depend on Exchange's business-bound Product Session V1 authorization and distinct native mandate/order signatures. The published `ynx-quant-execution-adapter-v2` mandate format is a different version domain, not Product Session V2 authorization. V2 login proofs must NOT be relabeled/forwarded as V1. The UI refuses native proof production with `NATIVE_MANDATE_SIGNATURE_AND_EXCHANGE_V2_ADAPTER_REQUIRED`; the server rejects a V2 proof at these native routes with `native_exchange_v2_adapter_unavailable`. Native Wallet exact-action signing and an Exchange V2 accepted-identity boundary are separate owner handoffs. Standard `0x` addresses/read mappings do not confer `ynx1` mandate authority.

## Evidence limits and publication prerequisite

Private controls, status and dynamic failure explanations follow all twelve existing locales with English default; canonical error codes remain available as DOM data, not untranslated English messages. Guest account verification fails before creating a key/session or an HTTP authorization request. Private UI copy is product-owned, not a replacement protocol. The fixed-height Standard Wallet header previously clipped mobile/RTL buttons; responsive sizing now keeps every visible wallet action inside the header and above the separate private strip, asserted in actual Chrome for all twelve locales.

Focused verification at this source: `npm test` 18/18; `npm run test:wallet-flow` 16/16; `npm run test:private-session` 6/6; `npm run test:private-protocol` 3/3; `npm run test:browser` 4/4; `npm run test:tenant-flow` 1/1 (two tenants, two processes, 12 concurrent duplicate requests, conflicting-body 409 and restart replay); `go test -race -count=1 ./internal/productsessionv2 ./internal/quantlab ./apps/quant-lab/server` PASS; source scanner, Node syntax and `git diff --check` PASS. `YNX_QUANT_POSTGRES_TEST_URL` is absent, so PostgreSQL integration remains unproved.

Owner tests use actual local Chromium/WebCrypto/IndexedDB and the unchanged SDK, but intercepted time responses/test providers and synthetic rejection callbacks. Additional private-protocol tests use the byte-identical official Wallet offline kernel from source 9840ef87, bundled by Finance's `build-private-test-kernel.mjs`: `tests/fixtures/wallet-test-kernel-9840ef87.mjs`, 119,170 bytes, SHA256 `5f711edad9a4ade05d3bc2353ac989ae4c1465cfb79b50e4bc600f1af4f70bd1`. Its official sign/return/kernel functions generate disposable test-scalar approval fixtures. They prove local challenge/complete, a fresh proof per API, replay rejection, two isolated users, refresh/second tab, stale callback rejection and persisted failed-revoke retry. All HTTP is intercepted; the product API boundary in these Chrome tests is a test wrapper around the official kernel. Go owner policy tests independently use a named authority test double; the unchanged shared verifier additionally runs its real SDK-signed offline vector. None is real installed-wallet approval, public Auth completion, confirmed remote revoke, successful native open, sign/transaction or WalletConnect evidence. Public/installed/approval/session-lifecycle/migrated flags remain false.

The canonical product URL is `https://quant.ynxweb4.com/`; this slice makes no external request. The Linux candidate must be paired with a NEW Central-approved exact service/host/current/symlink/state/env/Caddy/binary/Web inventory and rollback binding. Do not reuse the historical candidate systemd path. The candidate uses `apps/quant-lab/server` with archive-root WorkingDirectory and `apps/quant-lab/web` intact. Verify `/`, `/wallet-auth/callback`, `/api/version`, `/api/health`, `/api/ready` and each asset. PostgreSQL remains mandatory for production multi-instance readiness; local two-process file-state tests do not prove it.

Rollback must restore exact saved current release, service configuration, environment and durable state under its own signed prewrite conditions; archive extraction alone is not release authorization. A server tar.gz is NOT a user installer or a ZIP download replacement.
