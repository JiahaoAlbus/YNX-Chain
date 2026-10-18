# CCTP V2 testnet route consumer contract

Baseline: `c56946b5a60a26e660894e6367b9de0fc41e89b7`, original Wallet owner retains main/preload/IPC/vault/journal/router/package and final integration. Only this directory is owned by the cross-chain thread. Read the root `docs/engineering/YNX_EXECUTION_POLICY.md` and the frozen `wallet-feature-integration-20261018/OWNER_CONTRACT.md`.

This is an Electron/Node module plus a browser-only renderer. It is not an Android build, a second bridge, a new signing provider, or an installed delivery. It uses original `EVMAdapter.sign/broadcast`, transport, amount utilities and `AtomicMultiFile`; ethers remains the baseline dependency. No new package or lockfile is required.

## Pinned route

Ethereum Sepolia (11155111, domain 0) → Base Sepolia (84532, domain 6), Circle native test USDC, six decimals. `cctp-wire.mjs` carries exact token and contract pins. Standard finality threshold 2000 only; no swaps, hooks, relayer or mainnet. Source amount and destination amount differ only by the bounded Circle protocol fee; slippage is zero. ETH gas for approval, burn and mint has separate original Wallet reviews. `maxSourceGasFeeWei` is a per-source-action cap, so approval plus burn may cost up to twice that cap. `maxDestinationGasFeeWei` caps mint gas. No unlimited approval is produced. Existing sufficient allowance can skip approval.

Circle fee GET is a current unsigned fee-rate observation, not a reservation. The local 120-second quote/review lifetime is our UI policy, not Circle's separate TokenMessengerWithFees quote expiry. Zero protocol fee cap is supported when Circle standard fee is zero. Failure never substitutes a fallback fee. Source transaction/nonce and destination claim are never resent on timeout.

YNX is not listed in Circle's supported domains/deployments. YNX routes remain unavailable; external-chain transaction support does not create a YNX classical-signature fallback. CCTP V2 does not support cancel-after-burn or automatic original-chain refunds. Query original source/message/nonce/destination. An expired proof needs Circle's documented same-nonce re-attestation; this standard-only module reports that condition and does not issue a new burn or silently request another claim.

Sources verified on 2026-10-18:

- https://developers.circle.com/cctp/references/contract-addresses
- https://developers.circle.com/stablecoins/usdc-contract-addresses
- https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- https://developers.circle.com/api-reference/cctp/all/get-burn-usdc-fees
- https://developers.circle.com/api-reference/cctp/all/get-messages-v2
- https://developers.circle.com/cctp/howtos/troubleshoot-transfers
- https://developers.circle.com/cctp/migration-from-v1-to-v2
- https://github.com/circlefin/evm-cctp-contracts/tree/7d703109a2cfcb3f76375fef5f1a97f03c447b94

## Original Wallet integration

Use one original `MultichainService` with a `CctpEVMAdapter`; it extends existing behavior and delegates every non-CCTP call to the original implementation. The actual added adapter method is `prepareCctp(network, account, cctp) -> {amount, fee, transaction}`. `describeCctpAction`, `validateCctpRecord` and `verifyCctpSignedRecord` are the closed action validators. The marker is exactly `{version:1,intentId,step,binding,proof}`. Original service creates it internally and persists it with the original journal record before custody. Native and ordinary ERC20 record validation stays intact. Original journal must bind the complete marker during cancellation and preserve the pre-sign/UNKNOWN barriers.

`CctpFlow` calls these original-owner methods:

```js
wallet.context({unlocked: true})
wallet.snapshot()
wallet.assert(context, configRevision)
wallet.prepareCctpStep({intentId, step, binding, proof})
// -> {id, intentId, step, expiresAt, fee, transaction, ...originalReview}
wallet.send(reviewId, originalGuard)
wallet.cancel(reviewId)
wallet.checkCctpStep({id, network, account})
// -> original public journal record; never selected-network lookup or resubmit
```

The full `binding` is `{routeId,account,recipient,amountUnits,maxFeeUnits,maxSourceGasFeeWei,maxDestinationGasFeeWei,sourceNetwork,destinationNetwork,context,configRevision,expiresAt,quoteId}`. Both networks come from the original saved configuration and must have exactly the selected route chain IDs. Source and recipient are nonzero EVM addresses. All quantities are decimal strings. Main captures context/config revision; the renderer cannot supply them. At each new step, the main coordinator refreshes current lifecycle context and a 120-second review expiry, but the persisted route inputs, endpoints and limits cannot change. Proof is null except mint and comes exclusively from the bound reader.

Create `CctpReader`, `CctpStore({filePath: path.join(userData, 'cross-chain-cctp-v1.json')})`, and `CctpFlow({wallet: multichain, reader, store})` in original main. There must be one store writer per profile. Do not put raw signatures or keys in this new file. `CctpStore` uses existing atomic fsync/rename storage and preserves invalid files. CCTP dispatch records precede original `send`, and a missing acknowledgement leaves the operation query-only. Original journal remains authoritative for signed bytes and nonce custody.

Mount `installCctpIPC({handle,safe,sensitive,flow,getGuard})` using existing trusted-main-frame `handle`, lifecycle wrappers, and original guard supplier. Only route input and opaque IDs cross preload. Do not expose `prepareCctpStep`, arbitrary calldata, `binding`, or `proof` as a raw IPC signing endpoint. Explicit cross-chain confirmation must be the only way to consume its CCTP review ID; generic EVM IPC must not let a caller consume that review outside the cross-chain coordinator's durable barrier. Source and target networks must remain protected from removal while route history is unresolved, even between individual original journal operations.

The preload surface has eight methods: `routes`, `quote`, `start`, `prepare`, `confirm`, `check`, `cancel`, `history`. Confirm has `{id,reviewId}` while other operation methods take an ID. `routes/history/check` use safe read wrappers; others use original sensitive wrappers. Responses preserve original `{ok,value}` / `{ok:false,error}` envelopes. Include `store.pendingNetwork(networkId)` in the original network-edit/removal guard, across all accounts. On cold restart, an operation durably still at `review` may be cancelled when the original Wallet reports `reason:'review-only'` (the original ephemeral review is absent). A dispatching/signed/UNKNOWN operation can never use that path.

The recovery successor to frozen `9f90a67f076527bb92298ce6685f07f2ac591438` retains this same eight-method surface. `cancel(id)` returns `{cancelled:true,reason:'review-only',record}` when it discards only the current unsigned review after prior confirmed steps. Its durable operation must be `review` with `hash:null`; the original Wallet must return a boolean `cancelled`, `reason:'review-only'` and no nonnull hash. Prior operations must all be included. The transfer stays `burn-ready` or `mint-ready`, retaining prior hashes, proof and immutable inputs. The user must request a fresh opaque review ID and explicitly confirm it. The UI labels this action “Discard current review” / “取消当前预览”; it does not cancel an included burn. Before any dispatch, cancelling the whole intent still returns `{cancelled:true,record}` with state `cancelled`. A blocked cancellation returns `{cancelled:false,reason:'query-original',record}`. An ambiguous original response throws `CCTP_CANCEL_UNKNOWN` and leaves the record intact.

The store stays version 1, accepts old records, and preserves up to 32 operations per intent, including cancelled unsigned reviews. Operation IDs are unique; each step has at most one noncancelled operation. A cancelled or review operation has no hash; submitted/included/reverted operations require a hash. Do not trim history. `CCTP_REVIEW_HISTORY_FULL` refuses another preview before calling the original Wallet. Consumers must deploy this validator with the matching flow and UI; do not downgrade a profile containing repeated cancelled steps to the original three-operation validator.

Read recovery captures the current account, lifecycle context and configuration revision, checks both original saved network identities, and asserts that context after awaited original lookups and attestation/destination reads. Old creation-time context is not a current approval. Missing/uncertain source inclusion returns the flow to its corresponding pending state while keeping the original hash and proof as evidence. New preparation independently checks all active prior operations are included, so an old persisted `mint-ready` label paired with an unknown burn cannot grant a new claim preview. Original operation lookup remains available to resolve that state.

Mount `mountCctpUI({root,api,locale})` in the normal Wallet route. The return value provides `invalidate()` for lock, account change, focus loss and configuration change, and `dispose()` for unmount. The renderer suppresses late responses and consumes the review before confirmation IPC so timeout/error cannot render a second send button. It never signs automatically. Wire the normal history/reopen entry to this same panel and APIs.

The UI-wait successor to `dd83bf893a810ff3ca6c8f58905b4070447d829c` keeps this API unchanged. Each renderer action owns its waiting token. Invalidation retires that token and permits fresh read-only history/check actions even when the old IPC promise never settles; the old callback or `finally` cannot release a newer action or publish stale data. Each IPC has a 120-second renderer-wait deadline, covering the complete response wait. This is distinct from the reader's 12-second per-network-request limits and does not cancel, retry or replace a main-process operation, approval, signature or broadcast.

If start/prepare/confirm/cancel loses its response or is invalidated while in progress, the UI keeps an opaque recovery marker and withholds write actions. Only history and original-transaction checks remain available. A successful `check` for the same original intent clears the marker because original `CctpFlow.check` shares the per-intent `#run` guard with prepare/confirm/cancel. An uncertain start first locates its intent in history by the original `quoteId`, then requires that same check. A completed failed start followed by fresh history with no matching record can clear the start marker; an unresolved start cannot. A restored review still needs the existing explicit discard/fresh-ID/confirmation flow. None of these UI changes weakens persistent UNKNOWN barriers or grants another signing permission.

The app's normal network configuration must supply verified Sepolia and Base Sepolia RPCs. Do not weaken the existing genesis check: the first public-read probes found `rpc.sepolia.org` timeout and genesis block pruned (`4444`) at `sepolia.base.org`, `ethereum-sepolia-rpc.publicnode.com`, and `base-sepolia-rpc.publicnode.com`. A supported route and available Circle fees do not prove a usable configured RPC or target arrival.

## Verification and CI

Apply `integration-ci.patch` through original Wallet owner to add a single importer to existing `test/*.test.mjs`, preserving the current `npm test` / CI path. Run source-focused checks before any original builder work:

```sh
node --test apps/wallet-desktop/src/features/cross-chain/*.test.mjs
```

For an owner checkout that already integrated frozen `9f90`, apply `recovery-ci.patch` instead to append only the two new regression imports. Existing UI tests also contain the new recovery cases. For this successor, reuse the original 56-test evidence and run the new recovery/reconciliation tests plus affected flow/UI cases; do not re-run the old suite merely to reproduce its count. The full wildcard command above remains the normal CI entry for future changes.

For an owner checkout that already integrated `dd83`, apply `ui-wait-ci.patch` to append the one new UI-wait regression importer. Reuse the previous source/integration evidence. This delta requires only its new hanging-response tests and affected UI lifecycle/confirmation cases; no flow, reader, custody or network-pin behavior changed.

Controlled tests cover actual baseline adapter signing with public fixture keys (never broadcast), message/receipt binding, atomic-store restart, account switch, duplicate confirm, persistence failure, and unknown outcome. Three concrete RED cases were fixed: old-intent/new-account review race; expired proof blocking original mint lookup; confirmation IPC timeout leaving a reusable send button. Tests are not Circle attestation authenticity, a real Wallet approval, a real transfer, or installed acceptance.

Recovery successor RED cases cover a cold burn/mint review trapped behind included history, source receipt disappearance leaving mint readiness active, actor/config changes during an actual reader attestation, and a legacy stale readiness record allowing direct preparation without a query. Additional checks cover destination finality and original lookup races, cancellation uncertainty, disk failure, non-replay of signed/submitted/reverted operations, cancelled history, and normal renderer buttons.

Closure still requires original-owner integration tests and CI, one matching A-built installation, normal Wallet user approvals for test assets, actual source hash/message/nonce and target finalized mint receipt/balance, restart queries, then original website/download version synchronization. No separate package or publisher may be created.
