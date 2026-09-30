# Quant selected Hosted native read consumer

This checkpoint fixes existing consumers, not a new engine or an authorization
protocol. Source/local QA is verified below. Installed/public platform login and
business acceptance remain NOT_VERIFIED; another product's receipt is not proof.

## Source and authorization boundary

- Explicit selected Hosted/injected YNX uses the original SDK route, unique
  `ynx_requestProductSessionV2` and canonical SDK handleReturn. MetaMask never
  signs a native subject; selecting it does not silently select Hosted.
- Original `quant:account` purpose and device namespace remain separate from the
  explicit `quant:records:read` records consent/device. Central `identity:read`
  grants neither. No tenant, Paper, create/execute/revoke business permission is
  added. Existing native mandate/order authorization remains mandatory.
- Accepted Wallet source 4bccefef1149e9bacd41e5e5325eab40f650f59e, tree
  2202657cb8056e94dc044df3d318d7b5a5cdbf45. Reused shared generated adapter is
  exactly 12659 bytes, SHA256
  2567f4ec0958852ef27ee382067b6b104e33fe5dc3feba3aa94d710caa7f2c0a.
  Wallet source, protocol and deployment were not changed here.
- Only authenticated typed HOSTED_POPUP_CLOSED / known request expiry can mark
  transport unavailable while retaining valid server read authorization.
  This is not CONNECTED and a new signature is refused until explicit reconnect.
  Empty accounts, changed account/network/provider, unknown disconnect and
  explicit disconnect retire the bound read context, clearing old display.
- Native subject comes only from approved SDK/server session, not an EVM/native
  guessed mapping. Provider/revision/account/network fencing applies throughout
  approval and reads. Pending retirement is single-flight; late old cleanup may
  not retire a newer approval. Revoke failure is not confirmed remote revocation.

## Reproducible local gates

From apps/quant-lab:

```sh
npm run build:wallet
npm test
node scripts/verify-canonical-authorize.mjs
node scripts/verify-versioned-assets.mjs
node --test tests/records-session.test.mjs tests/private-session.test.mjs tests/cache-version-browser.test.mjs tests/wallet-flow.test.mjs
YNX_QUANT_HOSTED_WALLET_DIST=/Users/huangjiahao/.codex/worktrees/wallet-public-channel-20261001/apps/wallet-web/dist/hosted node --test tests/hosted-native-cross-service.test.mjs
```

20/20 source/business/reducer tests; canonical and four versioned asset checks
PASS. Chromium records/private/cache/standard lifecycle combination 27/27,
zero skips. After the final explicit-retirement change the records group 4/4 and
versioned assets PASS again. Real local Hosted two-user test 1/1 zero skips,
7.710 seconds after final business-source build. From repository root:

```sh
go test -race ./internal/quantlab ./apps/quant-lab/server -count=1
```

PASS 3.083 / 1.836 seconds. git diff --check PASS.

## Actual local service flow and limitations

The new opt-in browser/Go bridge uses actual encrypted Hosted vault creation,
backup acknowledgment, Wallet review/reject/approve, original signature/device
proofs, durable NodeHost and the original Go private-records endpoint. Canonical
HTTPS origins remain exact; only sockets are routed to isolated loopback. Other
network is blocked. No key/proof/cookie/active Pair URI is emitted.

1. Connection alone creates zero product sessions. Rejecting records approval
   creates no records grant and retains the standard connection.
2. Explicit records approval reads the actual native account's persisted mandate
   risk limit 100 and execution venueOrderId through POST /v1/wallet/private-records.
3. Closing Wallet retains the verified read; another fresh proof/read succeeds,
   but a new signing request fails PRIVATE_TRANSPORT_UNAVAILABLE.
4. Actual Go Close/New with current state, then browser reload, restores the same
   authorization and records without new approval.
5. A second independent Wallet profile creates B; actual Wallet account switch
   clears A display/authorization. B explicitly approves its own records and sees
   risk 101 / its execution, not A's 100. Revoke and reload remain guest.
6. Deferred approval + transport loss uses original SDK cancellation, then cold
   reload: the late approval cannot complete or restore an authorized session.

The test-only seed calls the existing RunBacktest/RegisterMandate/
SubmitTestnetWithSession APIs with explicit test mandate-verifier/broker doubles.
These are local persisted owned-record read evidence, not real execution,
real funds, live market data, public business success, or Paper ownership.
Original research/Paper tests preserve their independent stateless/tenant,
selected strategy, idempotency and signature boundaries. No new permission is
inferred from this records read. Platform-specific public use must be measured
independently after the unique release owner activates the compatible source.

### Subsequent existing Research/local-Paper actual-service regression

The same opt-in local test additionally uses an explicitly synthetic local
market adapter (fixture://synthetic-local-browser-only), not real public tape.
With a real approved Wallet records session, canonical remote-origin Research
calls the original stateless endpoint, receives 201, and renders actual backend
metrics and the measured equity SVG. Paper remains disabled on that origin;
the QA proxy supplies a remote Forwarded-For boundary instead of letting a
loopback destination grant local-preview authority accidentally.

A separate browser page on the actual loopback origin then exercises the
existing local-preview capability: a backtest saves a strategy; explicit Paper
submission returns 201, its real sequence-derived order ID appears in audit,
and reload restores the simulated workspace. This is not a Wallet/native
account-owned or public Paper grant. The combined test passed 1/1, zero skips,
6.125 seconds. Production authorization, UI and engine were unchanged for
this addition. The fixture initially attempted a hidden tab control and guessed
an order sequence; both assertions were corrected to the real visible tab and
backend audit receipt, not by loosening permissions or adding waits.

Remaining internal public-Paper integration gap: no durable verified native
account-to-workspace binding or product scope exists for remote Paper. A
browser tenant locator and records consent cannot fill that gap. Any future
explicit narrowly scoped Paper approval needs separately accepted registry,
Wallet candidate, fresh native proofs, account-owned workspace isolation and
durable logout/replay/restart policy. Do not silently expand quant:account,
quant:records:read or identity:read. No new scope is implemented by this test.

## Deployment / rollback

Deploy only this source's generated hash-bound wallet bundle and HTML together;
the verifier retains both historical input identity and accepted new adapter
identity checks. Shared graph/registry/scope did not change in this checkpoint.
Use the current compatible reader and current state, including existing SSO
bindings, with SSO disabled if necessary. Never restore an old snapshot or use an
old reader to erase revocations/bindings. No runtime/env/state was edited here.
