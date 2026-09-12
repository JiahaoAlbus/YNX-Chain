# Exchange read-only private account — source/build checkpoint

Owner branch `codex/exchange-financial-flow-20260912`; source `222a18b95eb05ed5d610c16eae5a0b515dfd0959`, tree `0984230e0d1ffab530f72637977a571687f8f868`. Predecessor backend checkpoint `aebbc9a5286f27c1f6b8748c2474a38b68be4105` includes the unchanged shared Go v2 dependency (see `EXCHANGE_SESSION_V2_BACKEND_HANDOFF_20260912.md`). This is not a public/installed/approved session claim.

## Exact SDK consumption

The browser SDK and registry come from Wallet's fixed source `9840ef871165eb523c4e7a3d48964dd25f8dee8e`, tree `4b3d86ea4bf98481a9448c694eb022b33cd36679`. Its complete `packages/wallet-auth/integration/browser-product-session-v2.md` was read. Both `createBrowserProductSessionClient` and `ProductSessionGatewayFetchAdapter` are imported from the same vendored module instance. No protocol, key store, introspection proof, callback parser or launcher was reimplemented.

| Owner path | Blob | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| apps/exchange/web/vendor/product-session-browser-9840ef87.mjs | e05bdb0738759a282c7e4d61773cabf6e34ff3f3 | 214746 | 5dc94d97925e4c0271c8c45255e0e409f257258e4e621f71fda26c4e2407a6e0 |
| apps/exchange/web/vendor/product-session-registry-9840ef87.json | 172d456ea3f6251dd6aaaa3462d76f9164817cfa | 7546 | 85c6995eddfbc175efaac01dbad31a4f5ef8878aab91613da2d689ef79921ab3 |
| apps/exchange/web/private-session-entry.js | cdbf3e8965e5002e7537079bbe43eba4b1792365 | 1241 | f8e0c89eb243f2ba0a54cd5cff93627f5071234f3f866c700870003f1212e102 |
| apps/exchange/web/private-account-controller.js | 94dc79142fc60378e0201859bbe516031f052519 | 8787 | fdd0b480bc2b6ee0baa7c1d4bade90d2ba5296802813ba2e2ef4b20a10be3fed |

The Standard SDK remains byte-identical c97f85e9. Private authority is fixed `https://wallet-auth.ynxweb4.com`; browser origin must be exactly `https://exchange.ynxweb4.com`. Legacy/no-authority session records are not read/migrated/deleted by this new SDK. Its non-extractable IndexedDB identity is not claimed hardware-backed or XSS-proof.

## Product behavior

1. Public markets and standard provider connection remain independent. Private sign-in requests **only** `exchange:read`; the panel explains this is native Exchange venue ledger identity, not an EVM Wallet balance or trade permission.
2. Explicit Prepare calls SDK `beginExplicit()`, which persists pending state and returns the complete URL. The UI exposes that exact SDK URL for another explicit user click. Native installation remains `unverified`. No automatic custom-scheme navigation, window.open, iframe or blank target exists. Standard YNX/MetaMask routes remain provider-only; MetaMask does not issue native Product Sessions.
3. The full `/wallet-auth/callback` URL goes directly to SDK `handleReturn`. No session-token extraction. SDK completion/introspection is followed by a fresh SDK proof for same-origin `GET /api/v1/account`; proof is never reused or sent as a bearer cookie. Callback URL parameters are cleared only after connected or SDK disconnected outcome, not on transient failures.
4. Verified account data populates existing balances, owned orders/activity/security readouts. Last-read available balance can appear in the non-submitting exact order preview. It is not a reservation or execution approval. Unsafe integer data, cross-account rows, old/malformed source metadata, HTML fallback and HTTP failures fail closed.
5. Refresh restores/re-introspects; every account request gets a new proof. Private outage/offline/expiry hides account data without calling standard disconnect. Retry reconciles through SDK. Guest hides local data without claiming revocation and automatic online recovery does not undo intentional Guest. Only SDK-confirmed private revocation is labelled confirmed; pending failure retains protected SDK state.
6. UI generation fences prevent late callback/proof/HTTP results from repopulating private views after Guest/new attempts. SDK remains responsible for its own persisted pending/revocation races. Private state/key/proofs are not stored in localStorage or logs by Exchange.
7. Product CSP adds only canonical Wallet/Auth to `connect-src`; direct browser RPC is not a connection prerequisite. The runtime packager now includes the compiled `private-session.js`; local static service tests prove exact bytes and JavaScript MIME for all four browser modules.

## Verification performed locally

- `npm test --prefix apps/exchange`: **55/55 PASS**, including 16 new private-account tests. These use the real frozen SDK for identity/origin checks, and explicit simulated adapters for controller lifecycle; no real Wallet approval, IndexedDB browser lifecycle or Gateway completion is claimed.
- `go test -race -count=1 ./internal/productsessionv2 ./internal/exchangeproduct ./apps/exchange/server`: PASS; `go vet` same packages: PASS.
- Node syntax on entry/controller/app; accepted Standard provider scanner; `git diff --check`: PASS.
- New fixtures: explicit ready route without account traffic; exact callback pass-through; fresh proof on repeated account reads; callback rejection; retry/offline; intentional Guest; private revoke success vs failure/expiry; delayed callback/HTTP cancellation; Begin coalescing; HTML/HTTP/unsafe integer/cross-account/source failures; local expiry. Backend fixtures separately cover two users/20 concurrent requests/restart and shared SDK-vector introspection. No PostgreSQL multi-instance test environment was provided.

## Frozen offline runtime

`/tmp/ynx-exchange-222a18b95eb0-20260912-linux-amd64.tar.gz` — **3,869,044 bytes**, SHA-256 `12c6647f3db5a39866e45bdf06f531b0b80b4b963d9e40295eb09bc778c1f6d6`.

Linux amd64 binary: 8,609,976 bytes, SHA-256 `766b50d57084898262e18771d031a3aaccd24da54d90229dc8c7409d99bb7e90`.
Private browser bundle: 134,561 bytes, SHA-256 `cc6953edb96717adf1eda63ea724bde91d257f9ac0bb66b39e06d2d5f17b439e`.
Manifest: 2,110 bytes, SHA-256 `69510107ea55c3fb7a948b70a9b146ad7660160adde8e0e7e842084c0114a466`.

Independent archive readback verified all ten entries, all eight binary/Web manifest entries and checksum-set digests, ELF class64/machine62, embedded exact source commit, and compiled private module equality to the source checkpoint. This tar is a server runtime archive, **not** a Windows/macOS/Android installer. It was not executed on Linux, installed or deployed.

## Exact remaining boundaries

No SSH, public deployment, browser automation, live account request, signing, order POST or chain transaction was performed. Public source binding, registered-origin browser IndexedDB/callback lifecycle and real native Wallet approval still need explicitly authorized direct verification. The same is true of standard injected-provider approval.

The first remaining order-execution dependency is Wallet's exact native action signing/public-key API for the existing `ynx-exchange-order-v1` payload (plus cancel/withdraw-review action-key binding). A P-256 Product Session device signature is not this signature. Current UI does not request trade/deposit/AI scopes or submit these actions; security/support v2 writes remain blocked until an explicitly registered write permission exists. No second ledger or order SDK was introduced.

Public URL expectation remains `https://exchange.ynxweb4.com`; no current HTTP/version claim is made here. Deployment needs its own source-bound authority and retained runtime rollback pointer. Source rollback is selecting the prior clean owner checkpoint; no public rollback was necessary.

`publicVerified=false`; `installedVerified=false`; `nativeWalletInstalled=false`; `browserCallbackVerified=false`; `accountApproved=false`; `productSessionV2LifecycleVerified=false`; `orderSubmitted=false`; `chainTransactionVerified=false`; `migratedV2=false`.
