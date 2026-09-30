# Quant identity and explicitly approved owned records

This is source/local QA evidence, not an installed Wallet, public Relay, or platform acceptance receipt.

## Permission boundary and real product paths

Central browser identity uses the existing registered Quant client and `identity:read` only. It does not create a tenant, enable Paper/Testnet, or grant native records permission. The old `quant:account` client and purpose remain unchanged.

The separate **Read my records** action requests only `quant:records:read`, with purpose: "Read my existing Quant mandates, execution status and risk limits. No creation, execution, revocation, Paper or tenant permission." Wallet approval is explicit. Rejection preserves the independent identity and Standard connection.

`POST /api/v1/wallet/private-records` verifies a fresh existing ProductSessionV2 device proof, derives the native account exclusively from that verified session, and checks any linked central identity. It calls the existing account-filtered `financePayload` reader for mandates, execution status and risk limits. This route runs on the root service and does not allocate a tenant or require/trust `X-YNX-Tenant-ID`. Other tenant/business routes keep their original policy. Account-only proof returns 403; records proof grants no create/execute/revoke/Paper rights.

The records pane shows the approved native account, existing mandate IDs/status, risk limits in protocol integer units, execution/order IDs/status/time, or truthful empty state. Provider/account/chain revision fences block late reads; transport loss alone does not revoke a valid server session. 503 clears the displayed data while retaining the valid session and an explicit retry. A new retry uses a fresh device proof, not another Wallet approval.

## Reproducible local checks

From repository root:

```
go test -race ./internal/productsessionv2 ./internal/quantlab ./apps/quant-lab/server -count=1
```

PASS: 1.352s / 3.605s / 1.328s. Actual TLS product endpoints use the original native verifier/client with isolated local QA authorities, not an installed Wallet. Two pre-existing native accounts receive only their respective mandates/executions/risk limits; unknown tenant header creates no state; product logout and restart reject old linked proof while the other account remains readable.

From `apps/quant-lab`:

```
node --test tests/browser-sso.test.mjs tests/records-session.test.mjs tests/private-session.test.mjs tests/private-protocol.test.mjs tests/cache-version-browser.test.mjs
```

14/14 PASS, 0 skipped, 6.762s. These are actual Chromium/local SDK fixtures, not real Wallet/public approval. Cases include explicit independent records scope, duplicate-click one request, rejection retaining identity, fresh read/503/retry without resign, restore, late account/provider reads, pagehide/pageshow delayed initialization fencing, locale labels, old private namespace, replay and cache binding.

`packages/wallet-auth`: `npm test` passed 206/206, 0 skipped, plus TypeScript checks. The Wallet candidate must inherit the new sorted official registry permission before real records approval can be claimed; this consumer does not edit Wallet implementation or silently extend old sessions.

## Durable rollback boundary

Populated `BrowserSSOBindings` participate in the existing Quant state integrity. A pre-SSO typed reader drops the new field and fails the integrity check: it is not a supported rollback reader. Supported rollback retains the current compatible reader and current state, disables SSO entry, and preserves linked-session fail-closed behavior. Never restore an older snapshot to remove authorization/revocation history.

The compatibility regression covers save/reopen, SSO-off linked rejection, Restore and DeleteAllLocalData preserving current bindings, and failed persistence retaining exact durable bytes. It does not change state schema or create a new engine.

## Activation and remaining truth

Central identity requires explicit `YNX_QUANT_CENTRAL_BROWSER_SSO=true` and a private cookie key of at least 32 bytes; keep that key out of logs/Git. Native records also require the existing `YNX_QUANT_PRIVATE_SESSION_V2_ENABLED=1` verifier configuration. Defaults remain off. The existing registered HTTPS authority is used; production cannot bind a loopback authority.

Identity controls currently recheck status on refresh/focus without implicitly signing or authorizing. Bounded top-level silent identity recovery is a separate next slice. Public approval, installed Wallet scope support, actual owned user records, and every platform remain NOT_VERIFIED until their individual runtime evidence is supplied.

## Frozen source and dependent runtime graph

Implementation source is `b90b3348b` (resolve this commit to its full SHA/tree before integration). The shared sorted official registry now permits `quant:records:read`; only the explicit separate records client requests it. Wallet release owner must consume that exact registry successor. Three graph-dependent bundles were rebuilt twice, producing immutable candidate `apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-records-b90b3348-20261001.json`: 73554 bytes, SHA256 `6fbcda664647a6189e05c8f6e4a052e0a5e657a9d0cafc1c60155a2b0f33f9b4`. Finance verifier manifest SHA256 `0c2a8cda82ec4e6b586a54919869cc6cdf0cdf1b38c363eb3970bce10207994c`.

Dependent EVM browser SHA256 `5608c2b82bba7813b37dff0b41660681754577024b3a383a504636caf3768702`; node authority `dd26710d346e7a51b5cb7f1645d01da50c8aef50a66864b9d77c1401920da41b`; central browser `2b241c0ccd7cef3f4feba4080865533f75d9b28c8c8e8d8b77e12c01287ade13`; Quant wallet `b71bbc62e0b758f8963627207f825053ca8eedcabbd574959af17d44faa36a99`. HTML cache identities match these bytes. Historical candidates remain untouched.

From `apps/finance`, `node --test tests/evm-read-verifier.test.mjs tests/wallet-bundle-verifier.test.mjs`: 21/21 PASS, zero skips, 1.446s. `node web/verify-wallet-connect.mjs`: PASS. The new exact candidate path is additional; transitive graph and tampering/locked-dependency guards are not weakened. Reproduce with the two current `build-guoqing-*` scripts at the frozen implementation source and locked workspace dependencies.
