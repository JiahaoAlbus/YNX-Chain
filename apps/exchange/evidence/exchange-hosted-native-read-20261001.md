# Exchange selected Hosted native read — source/local QA only

## Actual defects and narrow fixes

1. The explicit private-read action previously produced a native SDK URL/link,
   but never sent it to the selected installed/Hosted YNX provider. It now passes
   that exact URL through `ynx_requestProductSessionV2`, then gives the unchanged
   returned URL to the same original SDK client's `handleReturn`. MetaMask and
   unavailable transport cannot perform native approval. There is no auto-sign
   during standard connection, identity bootstrap, refresh or cold restore.
2. Real approval/complete/introspect succeeded, but Go `/v1/account` returned
   `403 CROSS_PRODUCT_SESSION`: its web policy used the native application ID.
   The exact original SDK web binding is `com.ynxweb4.exchange.web`. Only the web
   v2 policy and its simulated test vectors changed. Native/legacy bundle IDs
   and `exchange:read` permission did not change. Native-ID web proof is refused
   before authority traffic.
3. After that fix the actual owned API returned 200, but Web rejected it as
   `INVALID_ACCOUNT_SOURCE`. Schema10 uses `file-cas-single-host` or
   `postgres-cas-multi-instance`, not the old `file_snapshot`/`postgresql` aliases.
   The reader now binds the exact current modes, status and multiInstance pairs;
   stale timestamps, wrong account, unsafe numbers and false live claims remain
   rejected.

## Recovery and permission boundaries

Selected provider/account/chain/revision/generation are checked before native
request and before adopting its return. Same Begin clicks share one promise.
Pending cancellation retires the original SDK request once; late old completion
cannot retire or populate a newer request. Pending waits have request-expiry
bounds. Offline/Guest/close retire pending native work without claiming a
successful remote revocation when it is not confirmed.

Only accepted `HOSTED_POPUP_CLOSED` / `HOSTED_REQUEST_EXPIRED_OR_RELOADED` preserve
the transport's original binding, not signing availability. Already verified
server sessions can obtain fresh original-device proofs and read without the
popup. Empty accounts, unknown/explicit disconnect, account/provider/chain
change clear old display and retire the bound private session. Cold restored
native identity is not inferred from the transport's EVM address.

There is no trading/withdrawal, tenant, Paper/Testnet execution, SSO scope upgrade
or new engine. SSO remains identity-only; private read is separately approved.

Accepted Wallet adapter is the exact shared vendor
`packages/wallet-auth/src/vendor/hosted-wallet-adapter-4bccefef.js`, 12659B,
SHA256 `2567f4ec0958852ef27ee382067b6b104e33fe5dc3feba3aa94d710caa7f2c0a`.
Wallet source `4bccefef1149e9bacd41e5e5325eab40f650f59e`, tree
`2202657cb8056e94dc044df3d318d7b5a5cdbf45`. No Wallet source was edited.

## Reproducible checks

From `apps/exchange`:

```sh
npm test
node web/verify-wallet-connect.mjs
node --test tests/hosted-wallet-browser.test.mjs tests/cache-version-browser.test.mjs
YNX_EXCHANGE_HOSTED_WALLET_DIST=/absolute/accepted/wallet-web/dist/hosted node --test tests/hosted-native-cross-service.test.mjs
```

From repository root:

```sh
go test -race ./internal/exchangeproduct -run 'TestBrowserV2|TestBrowserSSO' -count=1
```

The actual cross-service case passed 1/1, zero skips (6.696s): real isolated
encrypted Wallet vault, backup acknowledgement, review/reject, review/password/
signature, durable NodeHost challenge/complete/proof and real Go schema10 owned
account endpoint. A's balance UI displays 17 YUSD_TEST from the existing isolated
`CreditTestQuote` helper, not a market price or production capital. Popup close,
new-sign refusal, fresh private read, actual service Close/New and browser reload
retain A's verified read and persisted balance. A second independent browser
profile creates/exports its encrypted Wallet backup; the actual Wallet imports
and switches it. A's display disappears and session is retired. B requires fresh
explicit approval and reads only B's 31 test quote, not A's 17. Explicit logout
is confirmed by actual Gateway revokedSession records; reload cannot restore it.
Backup/password/private keys/proofs are not logged or included in this handoff.

Unit fixtures are explicitly separate from this real local Wallet/Gateway/Go
composition. They cover late callbacks, once-only retirement/new-session races,
cold account change, empty/unknown events, exact web-ID and CAS-mode negatives.
The old P0 mobile endpoint receipt is not current Web authority: its verifier
retains historical mobile PENDING claims, permits only the exact bounded
same-origin identity helper, and rejects arbitrary helper/business routes.

## Release/rollback truth

Public approval, public owned-service use, installed extension/Desktop/mobile
and OS/platform lifecycle are NOT_VERIFIED by this local case. Finance public
Chrome rejection receipts reported by Root are separate, not Exchange approval.
Only the release owner may deploy. Preserve the current schema10 data and SSO
bindings; supported rollback uses a current compatible reader with SSO disabled,
never an old reader or an old snapshot that erases history. Gateway authority,
revocation, clock/checkpoint and product state must not be reset. The original
protected route and provenance checks remain enforced.

Final source gates: npm test 72/72, zero skips (3.008s); Wallet verifier PASS;
chooser/cache Chromium 2/2, zero skips (3.036s); expanded actual two-account
Hosted/Gateway/Go case 1/1, zero skips (6.523s); focused Go race PASS (2.083s).
HTML and module cache keys bind these exact generated assets:

| Asset | Bytes | SHA256 |
|---|---:|---|
| wallet-connect.js | 37764 | a031dab0a4422157a11450cc69d098b404030b8503dd0284892e621e835d45b6 |
| private-session.js | 136529 | ef1b89eef8e13e2ad27bc8893c5d4f09bf8c9fe21bb3b54498e34eb828a74675 |
| app.js | 28108 | c251c168b24e02b1cad9671abc1d96c02b68109890ca2c29481c92b6b1b1679a |
| index.html | 15995 | e94ce1e358e4061a137b02f4110fce8ab7c9f88a858da6645158810313694a10 |
