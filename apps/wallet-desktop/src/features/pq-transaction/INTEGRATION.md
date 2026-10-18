# PQ transaction consumer integration

Read `/Users/huangjiahao/Desktop/YNX Chain/docs/engineering/YNX_EXECUTION_POLICY.md` and `/Volumes/西部数据/YNX-large-work/wallet-feature-integration-20261018/OWNER_CONTRACT.md`. This feature owns only this directory. The original Wallet owner owns main/preload/IPC, authority, vault, shared journal and final integration; original Auth owns the transaction permission supplier and its pins; A owns packaging/publishing. No GUI, package, test-asset effect or public deployment is authorized by this source handoff.

Baseline: `c56946b5a60a26e660894e6367b9de0fc41e89b7`, tree `309e0a1036f4faf431e676cac5006fba4d367efc`, SDK318. SDK325 retains the same typed transaction crypto APIs according to its original owner; it has not been mixed into this checkout.

## Main-only exports

- `pqTransferReviewBinding(originalPending, {account, networkId})`: closed public intent DATA for the existing `ynx_signPQNativeTransfer` review. `intentSha256` correlates the complete existing SDK encoding; it never replaces the complete message signed by both PQ algorithms.
- `preparePQTransferOriginal(original, {account, networkId})`: reuses the original codec, Member wire, native hash and ABCI hash. Its `original` and `request` remain private in main. Only `binding` may be shown.
- `readPQTransferOriginal(intentStore, hash, {account, networkId, guard})`: requires the retained original journal record, checks lifecycle before/after read. It does not create another record or sign.
- `createPQTransactionSubmission({intentStore, networkId, acquireOriginalWalletTransactionPermission, isOriginalWalletTransactionPermission, transport})`: main singleton. `broadcast(hash, guard)` requires the current original peer for a NEW broadcast approval. `reconcile(hash, guard)` only reads the original BFT result, captures it in the same journal and returns public progress. `assertSafeToClose()` fences exit while active calls or foreign cleanup debt remain. Preserve this singleton until actual cleanup; do not reconstruct it to clear debt.
- `createPQTransactionNodeTransport()`: fixed `node:https`, existing `NORMAL_OPERATOR` origin/SPKI/release plus canonical genesis. No caller URL or redirect/retry. The narrow `submitTransfer(request, assertCurrent)` rechecks current after awaited preflight and immediately before POST. The test kernel is not a production authority.
- `projectPQTransactionProgress(value, {account,hash,kind})` and `pqProgressReadUnavailable(binding)`: closed public DATA. Unknown/rejection/read failure never claim submission or inclusion. Inclusion remains `consensusFinality:false`; no retry or original deletion is granted.

## Original approval integration

Keep `DesktopWalletAuthority.requestPQTransfer({to,amount})`, its original provider pending review, `approve`, `withPQKeys`, `signPQWalletNativeTransfer`, and `intentStore` as the sole signing path. Do not add a raw-sign callback or expose keys/wire over IPC.

Auth's R93 proposed factory is `acquireOriginalWalletTransactionPermission(request, capsule, borrow)` plus its original WeakSet recognizer. Main may close over the REAL capsule and private borrow in the single-argument factory supplied to this consumer. The capsule must come from `captureOriginalWalletTransactionApprovalIPC(event,reviewId,action)` after the actual `assertWalletIPC` check. The private borrow must be owned/branded by the existing authority, including its active review after pending removal. No boolean, ordinary login, IDENTITY proof, renderer-supplied borrow, or callback source is equivalent. A broadcast requires a new original review/capsule; the sign approval is not broadcast permission.

The consumer's broadcast permission request is `{action:'broadcast',networkId,nativeChainId,account,operationId,origin:'ynx-wallet:local-pq',transfer:{chainId,nativeChainId,from,to,amount,fee,nonce},requestDigest,transportHash}`. `readOriginal()` must return the frozen request fields plus fixed `issuedAt`/`expiresAt`, optionally `policyRevision`; repeated reads must preserve object identity. It calls `recheck`, `enterBroadcast()` (synchronous undefined, no network effect), `complete({outcome:'returned'|'unknown',transportHash})`, and `retire/join/close`. These are candidate consumer bindings until checked against the frozen R93 handoff.

Order: original signed journal → real permission/current checks → durable UNKNOWN marker/readback → permission recheck/one-time entry → existing key lifecycle effect gate → typed node POST → capture/save raw result BEFORE late current or completion checks → public progress. Any prior marker fences another POST, including after restart. GET recovery requires no new sign/broadcast permission and preserves the original. A read of a signed-only original does not manufacture a submission marker.

Use `guard.assertEffectCurrent`, not `guard.assert`, after the existing lifecycle's submit gate has consumed key access. Root transport errors are captured inside that gate before it wraps them. Failed foreign cleanup fences another acquisition. Late returned bytes are retained before lock/permission errors.

## Tests and owner CI patch

Focused command: `node --test --test-concurrency=1 apps/wallet-desktop/src/features/pq-transaction/*.test.mjs`. All tests use original codecs, public producer fixture and actual original journal; adversarial tests use `DesktopKeyLifecycle`. Peer/HTTPS responses are controlled. These tests do not establish actual Auth approval or chain finality.

The owner handoff supplies an exact new `test/pq-transaction.test.mjs` import shim so the existing `npm test`/CI glob runs these tests. No package/lockfile/workflow was edited here. Node-only imports remain desktop-only; no mobile integration claim.

## Remaining original-owner gates

1. Auth: frozen R93 production supplier and real peer/current/revocation; Wallet: private branded review borrow, true sign/broadcast UI/IPC and normal integration.
2. Auth/Protocol: update the original operator release/trust pins only after the exact deployment is verified. Current inherited pin is the old public `65efa82e0615`; this module does not silently accept a new node or alternate endpoint.
3. Protocol: versioned transaction inclusion + execution result proof, with the two adjacent complete commit/light proofs and real Source trust. A header proof or Comet response alone is not transaction finality.
4. Wallet: original store terminal/history contract after independently verified finality, retaining signed wire, markers, balances, nonce and history. Current originals remain conservatively unresolved.
5. Original Wallet/A: final same-version Mac/cross-chain/PQ package, normal install, original-key restoration, real approval, isolated test-asset transaction/finality/restart, and matching public download/docs.
