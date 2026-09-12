# Quant private account — owner source candidate

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

Recovery re-introspects stored sessions via SDK `restore`. Pending-only state is preserved as `awaiting-return` rather than initiating a replacement request: nonce/state survive refresh or another tab until callback/new explicit attempt/rejection/expiry. Sign-out calls SDK `disconnect`; Retry calls `retryDetected`, preserving an unconfirmed revocation target. Pagehide/network/operation revisions prevent stale UI or account responses from reviving prior state. No session/key is exported, logged or manually migrated.

## Server/API contract

Enable with **only** `YNX_QUANT_PRIVATE_SESSION_V2_ENABLED=1` on the source-bound `apps/quant-lab/server` runtime. Default is unavailable. No configurable client-provided authority, origin, callback or scopes are accepted. CSP permits private connections only to the fixed authority in addition to self; frames remain disabled.

`POST /api/v1/wallet/private-account`, body exactly `{}`, requires the existing browser tenant header and `X-YNX-Product-Session-Proof-V2`. Each UI request calls SDK `createIntrospectionProof(['quant:account'])` afresh. The server independently chooses that scope and invokes the unchanged Go verifier, which submits canonical `{requiredScopes:['quant:account']}` to `/v2/product-sessions/introspect`. This body is NOT the product business body. No proof/decision cache or automatic replay is added. The shared authority must reject consumed proofs.

Registered binding: product `quant`, client `ynx-quant-v1`, application `com.ynxweb4.quant.web`, platform `web`, origin `https://quant.ynxweb4.com`, callback `https://quant.ynxweb4.com/wallet-auth/callback`, null bundle/package, chain `ynx_6423-1`.

The read-only result exposes verified native account, session binding, expiry and authority, explicitly `nativeExecutionEnabled=false`, `paperWorkspaceLinked=false`. It grants no write to the Paper tenant. This single read-only POST is exempted from the local-Paper mutation guard and protected by shared V2 authorization instead. Existing native/strategy write guards remain unchanged.

## Real remaining execution boundary

`/v1/testnet/mandates` and `/v1/testnet/orders` still depend on the existing Exchange business-bound V1 adapter and distinct native mandate/order signatures. V2 login proofs must NOT be relabeled/forwarded as V1. The UI refuses native proof production with `NATIVE_MANDATE_SIGNATURE_AND_EXCHANGE_V2_ADAPTER_REQUIRED`; the server rejects a V2 proof at these native routes with `native_exchange_v2_adapter_unavailable`. Native Wallet exact-action signing and an Exchange V2 accepted-identity boundary are separate owner handoffs. Standard `0x` addresses/read mappings do not confer `ynx1` mandate authority.

## Evidence limits and publication prerequisite

Focused verification at this source: `npm test` 18/18; `npm run test:wallet-flow` 16/16; `npm run test:private-session` 5/5; `npm run test:browser` 4/4; `npm run test:tenant-flow` 1/1 (two tenants, two processes, 12 concurrent duplicate requests, conflicting-body 409 and restart replay); `go test -race -count=1 ./internal/productsessionv2 ./internal/quantlab ./apps/quant-lab/server` PASS; source scanner, Node syntax and `git diff --check` PASS. `YNX_QUANT_POSTGRES_TEST_URL` is absent, so PostgreSQL integration remains unproved.

Owner tests use actual local Chromium/WebCrypto/IndexedDB and the unchanged SDK, but intercepted time responses/test providers and synthetic rejection callbacks. Go owner policy tests use a named authority test double; the unchanged shared verifier additionally runs its real SDK-signed offline vector. None is real installed-wallet approval, public Auth completion, confirmed remote revoke, successful native open, sign/transaction or WalletConnect evidence. Public/installed/approval/session-lifecycle/migrated flags remain false.

The canonical product URL is `https://quant.ynxweb4.com/`; this slice makes no external request. The Linux candidate must be paired with a NEW Central-approved exact service/host/current/symlink/state/env/Caddy/binary/Web inventory and rollback binding. Do not reuse the historical candidate systemd path. The candidate uses `apps/quant-lab/server` with archive-root WorkingDirectory and `apps/quant-lab/web` intact. Verify `/`, `/wallet-auth/callback`, `/api/version`, `/api/health`, `/api/ready` and each asset. PostgreSQL remains mandatory for production multi-instance readiness; local two-process file-state tests do not prove it.

Rollback must restore exact saved current release, service configuration, environment and durable state under its own signed prewrite conditions; archive extraction alone is not release authorization. A server tar.gz is NOT a user installer or a ZIP download replacement.
