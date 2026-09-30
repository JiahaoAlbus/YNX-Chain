# Finance Guoqing account-session checkpoint

Base: `646b0700558662c0ca58f346892b222dc7527d63`.
Branch: `codex/finance-guoqing-session-20260930`.
Scope: Finance-owned F04 connection/login recovery only. F04/R05 remain incomplete.

Implemented: main Finance login now calls the existing EVMRead device-bound session issuer and server-verified account portfolio, not the old one-shot `verified:true` endpoint. Assets/overview/activity show that account's real read result, without granting native planning, Broker, other product or write scopes. Native ProductSession-v2 and legacy verifier remain unchanged. Refresh restores only after a fresh device proof succeeds at the backend; 401/403, account/provider changes, expiry and logout clear the account display. No cookie or third identity system was added.

Revoke: local read access stops immediately. A bounded non-secret account/provider/session-id/expiry marker survives failed revoke and refresh; remote status remains unknown until expiry. No automatic signature/replay retry. A late old revoke cannot overwrite a newer session. The existing backend atomically commits challenge consumption/session issuance and consumes device proof nonces.

Verification (local QA, not public E2E):

- `go test ./internal/finance -run 'TestEVMRead|TestEVMLogin|TestEVMSubject' -count=1`: passed, including new two-real-QA-key HTTP session/read isolation and altered cross-owner proof rejection; existing atomic nonce/replay/revoke/expiry tests retained.
- `cd apps/finance && node --test tests/evm-read-browser.test.mjs`: 7 passed; main workspace, backend refresh, wrong chain/account clearing, offline logout + refresh, late revoke, rejected read, rejected signature, guest links and deterministic bundle rebuild. Browser transport/backend are isolated fixtures, not a live wallet/Relay/public-service receipt.
- Build: `cd apps/finance && node_modules/.bin/esbuild scripts/evm-read-browser-entry.mjs --bundle --minify --platform=browser --target=es2022 --outfile=web/evm-read-session.js`.

HTML cache hashes updated for app, locale and EVMRead bundle. Existing immutable candidate/manifest evidence is retained; it does not certify the changed bytes. Next checkpoint must generate a reviewed current-source candidate and verifier pin before N deploys. No SSH/deployment/publication was performed.

Exact remaining native dependency: `private-wallet-entry.js` passes constant false installation/scheme predicates to the existing `ProductSessionGatewayFetchAdapter`; `product-session-router.js::prepareWalletOpen` consequently returns `WALLET_NOT_INSTALLED`. Discovery is not proof of a scheme handler. Native flow needs a real supported provider/Pair/explicit bounded open capability from shared Wallet/Auth rather than changing predicates to true. Existing EVMSubject records enforce `nativeAccount:null`; no server-verified native mapping/session-issuance bridge was found here. EVM signature must not be converted into a native Product Session with client-claimed identity/scopes. Finance can consume shared Gateway/API once Root assigns its owner and exact contract.

F03/F08 remain: stale initial `discoveredYNX` and silent Hosted fallback. Reuse shared discovery; require explicit Hosted versus installed/provider selection, then request shared Pair/native adapter if absent. No new Pair protocol or SDK copy in Finance.

Truth: implemented=true for bounded account-read checkpoint; wired=true locally; published=false; endToEndVerified=false; userAccepted=false.
