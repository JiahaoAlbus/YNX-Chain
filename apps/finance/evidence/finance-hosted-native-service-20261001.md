# Finance Hosted native service consumer

Local source/real Wallet UI contract evidence, not public or installed-platform
acceptance. The consumer passes the original SDK route to the existing Wallet
`ynx_requestProductSessionV2` handler. No new identity/protocol/financial engine,
scope expansion, EVM-to-native authorization or Wallet source change is made.

## Accepted dependency and lifecycle

Wallet source 4bccefef1149e9bacd41e5e5325eab40f650f59e, tree
2202657cb8056e94dc044df3d318d7b5a5cdbf45 supplies the generated adapter:
`packages/wallet-auth/src/vendor/hosted-wallet-adapter-4bccefef.js`, 12659 bytes,
SHA256 2567f4ec0958852ef27ee382067b6b104e33fe5dc3feba3aa94d710caa7f2c0a.
Old vendor artifacts remain immutable. The central chooser and Finance consume
this same accepted artifact. Central origin still cannot request product scopes.

The old Wallet pagehide message was indistinguishable from identity/permission
loss and emitted empty accounts first. The accepted successor carries an
authenticated typed lifecycle reason. Only known popup/channel-expiry transport
codes preserve the already bound account and valid server business session.
Independent empty accounts, account/chain changes and unknown disconnect still
fail closed. The controller fences its generation; a late transport label
cannot restore an already removed identity. An offline transport is not a live
signer: a new native request remains unavailable until explicit reconnection.

## Actual local Wallet/Gateway/Finance path

Run from apps/finance with the accepted Wallet owner's generated dist directory:

`YNX_FINANCE_HOSTED_WALLET_DIST=/Users/huangjiahao/.codex/worktrees/wallet-public-channel-20261001/apps/wallet-web/dist/hosted node --test --test-name-pattern=hosted-provider tests/local-product-session-cross-service.test.mjs`

Result: 1/1 PASS, no skips, 6.055s; parent independent run also PASS 6.212s.
This case opens the actual Wallet-owned page on its canonical HTTPS origin,
creates a fresh isolated encrypted vault, acknowledges its encrypted backup,
connects, rejects native scope approval (zero server sessions), then approves
with the QA password through the real handler. It uses no signing substitute
or exposed approval fixture. The official return is consumed by the durable
Gateway; the actual Go v2 verifier accepts a fresh device proof. The product
creates and reads an owned category. Closing the Wallet produces transport-only
state, retains private authorization and permits the protected owned API. A
real reload restores the same private session and persisted category. Explicit
SDK revoke is checked against actual Gateway revoked session bindings.

The routed Wallet files were: app.js 462242B SHA256
3749e835072b126154e92e924698dfd66a39c174cc8f2e6e9c8c838c5d9fde9b;
index.html 7099B SHA256 bf08c903e365a59fda4945245d06f05ed76778fad0df236c5aeb9db69e15cb1c;
hosted-wallet.css 3670B SHA256 c35101b0ff9563a0938f5960e7cf90ef50fa4979980b2bf05653197a98268cb1.
The fixture blocks unrelated network and never logs backup contents, passwords,
keys, cookies, proofs or channel URL fragments.

## Other regression and limitations

Central actual-browser plus controller matrix: 10/10 PASS, no skips, 8.510s.
Standard Wallet/private boundary/controller regression: 43/43 PASS, no skips.
Existing central native owned-budget/report/cold-refresh case after the consumer
change: 1/1 PASS 14.827s. These are local Chromium/Node/Go results. Public
provider approval, balances/history availability, installed apps, real Relay
and each platform's actual owned service remain separate NOT_VERIFIED items.

The release owner alone activates runtime. Preserve existing ProductSession,
revocation, authority clock/checkpoint and product state. Do not renew trust or
reuse a historical public receipt based on this source-only handoff.
