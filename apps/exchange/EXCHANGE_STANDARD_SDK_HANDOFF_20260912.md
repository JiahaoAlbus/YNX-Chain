# Exchange shared Standard Wallet SDK consumption

Source `445c48101fd8e64d066c8a0e693a03089dd8c9d3`, tree `d24710c43ac2e0406ebe38f427711663c5bda288`, branch `codex/exchange-financial-flow-20260912`. Includes guest market, exact preview and funded settlement prior checkpoints; only Exchange owner paths changed. Original worktrees and ahead commits remain preserved.

## Exact shared input and adapter

Wallet SDK source `c97f85e9ae4d4580b99860c51738e6040ca9ca18`, tree `28a660bbe1451f0d5e20d6eb08da17eef0970d77`. Unmodified standalone ESM vendored at `apps/exchange/web/vendor/standard-wallet-browser-c97f85e9.mjs`, 22,417 bytes, SHA256 `b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43`, no external imports. It provides provider discovery and `StandardWalletConnection`; the existing accepted shared reducer remains the product presentation state. No second protocol, signing implementation or credential store was introduced.

The product adapter selects exactly YNX or MetaMask from shared discovery, uses SDK requests for 0x1917 switch → 4902 add → re-switch → chain check, then SDK connect (account + chain readback). Only the public provider kind is saved under `ynx.exchange.standard-provider.v1`; account, session/proof/private key are not persisted there. On reload only that remembered provider is silently restored through SDK `restore()`. No remembered choice means no provider account reads and no implicit default YNX binding.

SDK event/generation fences plus product intent fences protect account changes, chain changes, disconnects and superseded discovery/network checks. Repeated same-wallet clicks share one attempt. Success clears the shared pending state and closes the chooser/restores focus. Local disconnect is labelled distinct from permission revocation. Explicit revoke has a user confirmation and only claims permission removal after SDK acknowledgement plus empty `eth_accounts` readback; unsupported/rejected/invalid acknowledgement remains unconfirmed. Token approvals and venue orders are never implicitly changed. Accepted RPC probe degradation does not clear a standard connection. No browser custom scheme or blank-tab launcher exists.

## Tests and build

`npm test --prefix apps/exchange`: 39/39 PASS. Eleven shared-SDK consumer tests execute the exact vendored SDK against deterministic event-emitting provider fixtures: two-wallet selection, add/re-switch, wrong chain, no-provider, remembered-only silent restore, account/chain events, confirmed/unsupported/rejected/false-ack revoke, delayed approval fenced by disconnect, duplicate click coalescing, malformed accounts/user rejection, RPC degradation; exact bytes/hash also verified. These are not actual installed-provider approval results.

`go test -race ./internal/exchangeproduct ./apps/exchange/server`, `go vet` for both, Wallet build, exact SDK source verifier, static module MIME/bytes, Node syntax and diff whitespace gates PASS. Guest HTTP/SSE/restart and ledger invariants remain covered. PostgreSQL multi-instance runtime not available for local testing; no public/browser/device assertions.

Offline Linux amd64 archive `/tmp/ynx-exchange-445c48101fd8-20260912-linux-amd64.tar.gz`: 3,705,832 bytes, SHA256 `2b6d55b5371c7681ae003ae653daf07737cfeb0d8ba971dd5019d131dfd7d970`. Binary 8,306,872 bytes, SHA256 `989d1c41523942dd0b569be326472b2b861e34f19f8aedfa4d77b1fc00afbfdc`. Generated `wallet-connect.js` 21,026 bytes, SHA256 `49c4f6374eb6b8ce282704dbac75478a1c8b84ff4ee8293a67d68c4eff3e14e1`. Six Web assets plus exact per-file manifest. This is not a hosted download or user installer.

## Next private-account boundary (not promoted)

The main agent's exact private ESM/registry were read together with source `packages/wallet-auth/integration/browser-product-session-v2.md`. Registry Exchange is `ynx-exchange-v1` / `com.ynxweb4.exchange` / `https://exchange.ynxweb4.com`, with read/trade scopes. `createBrowserProductSessionClient` uses IndexedDB non-extractable WebCrypto, persists pending before Wallet approval, handles exact callback URL, and returns a fresh `X-YNX-Product-Session-Proof-V2` per API attempt.

Exchange's current owner backend still uses `/v1/wallet/sessions/introspect` and `X-YNX-Product-Session-Proof` (server.go: HTTPGatewayAuthorizer), accepting only wallet-auth-v1/native-account binding. Therefore merely vendoring private ESM must not enable private balance/order calls. Next product-owned vertical must consume the v2 client **and** exact v2 API-introspection contract, keeping old sessions at original authority and optional private failure separate from Standard state. New private requests use canonical `https://wallet-auth.ynxweb4.com`; public runtime acceptance was not checked here. Native order action signature remains independently required; Product Session is not an order signature.

Public deployed, installed provider verified, actual account approved, callback verified, signed, testnet send/order execution and Product Session migrated all remain false. No SSH, public browsing, account/signature or transaction was performed. Any live release requires a separately authorized exact source/runtime/rollback plan. Route remaining issues only to “接续测试网生态审计工作” (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`) via the Finance coordinator.
