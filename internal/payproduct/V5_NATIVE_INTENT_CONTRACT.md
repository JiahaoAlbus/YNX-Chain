# Normal Native invoice intent producer: Cloud and Shop

This extends the original Service/Store/Server and the CORE-native module. It does not call legacy `CreateInvoice`, invent a signature codec, or hold merchant keys. Build `pay_pq`; add `pay_cloud` only for the optional adapter implementing Cloud's actual interface.

## Normal private composition

1. Original Auth/Source supplies `NativeInvoiceSourceReader.ReadInvoiceIntentSource`: one authenticated current caller, immutable approved bill/order, registered product-to-PayMerchant-to-native issuer/store association, exact CORE terms and a short currentness fence. Its synchronous `Current` must be safe under the original Store lock. HTTP DATA, prices entered by a user and an ordinary callback cannot construct this capability.
2. Call `NewRegisteredNativeInvoiceIntentSource(originalService, realReader)`. This concrete adapter compares the entire originating intent and Source association, checks the active original Pay merchant and payout, checks Shop StoreID, and checks actual original MerchantMembers/`invoice` role for merchant review/Member return. It never discovers a merchant by recipient equality.
3. Call `NewPrivateNativePayServer(originalService, NativePayConfig{HTTP: actualCoreClient, Authority: actualNativeSource, ProofSource: independentlyTrustedSource, Genesis: originalGenesis, NativeChainID: actualID}, registeredIntentSource, buildInfo, logger)`. This factory mounts both normal intent and original native routes. Missing dependencies return UNAVAILABLE; there is no private env/header/static grant fallback. Existing unrelated legacy private routes/readiness remain closed unless their original authority is also mounted.
4. Cross-service callers use `NewNativeInvoiceIntentClient(configuredOrigin, qualifiedHTTPClient)`; the client requires an explicit transport, fixes the origin, rejects redirects, bounds JSON and never retries a POST. Authentication stays in the original transport/Source.
5. Cloud normal composition uses `NewCloudNativeInvoiceProducer(clientOrInProcessIntents)` and passes the result to `cloud.Server.EnableIDEUsageBilling(realPricingAuthority, producer)`. It implements the existing `cloud.IDEUsageInvoiceProducer` interface without changing Cloud's sealed bill or making a second journal there. Mount it from the normal outer composition, not a mock pricing/provider path.

## Product DATA and fixed endpoints

`NativeInvoiceProductIntent` fields: `productId`, optional `storeId`, `sourceOrder`, `merchant`, `recipient`, `genesis`, `nativeChainId`, `assetId`, `unitVersion`, `amountAtoms`, `domainData`. All monetary/network uint64 values are decimal strings. `domainData` is the exact original approved product intent, bounded to 64KiB; it is not a new payment WIRE. The real Source must compare it with its own immutable bill/order. Terms IDs, payer policy, key epoch/revision, expiry execution height, maxFee1 and feeRule come from that Source and the sole CORE codec. Caller JSON does not choose an approved bill or issuer.

| Method | Exact private route | Body/result |
| --- | --- | --- |
| POST | `/v5/pay/invoice-intents` | product DATA → durable `PREPARED`, stable `intentId`/`originalOperation`, Source-bound CORE invoice/session/Money metadata |
| POST | `/v5/pay/invoice-intents/lookup` | exact original product DATA → same operation, read/reconcile original only |
| GET | `/v5/pay/invoice-intents/{intentId}` | original private intent and proof-gated invoice projection |
| POST | `/v5/pay/invoice-intents/{intentId}/merchant-review` | `{}` → original registered merchant-only CORE `message` base64, owner, nonce, fee1 and `signingMessageHash` |
| POST | `/v5/pay/invoice-intents/{intentId}/merchant-member` | `{member: base64}` → verify complete AND/N1 exact message, durably capture public Member, invoke original `RegisterTerms` once |
| POST | `/v5/pay/invoice-intents/{intentId}/reconcile` | `{}` → recover original hash/CORE query/actual H/H+1 verification; no signing or broadcast |

Stable `originalOperation` is the Pay intent ID throughout preparation/signing/submission/finality. CORE invoiceId/sessionId are fixed at preparation. The original native/ABCI hashes are added when the original Member is captured/submitted; they never replace the stable product operation. `signingMessageHash` is SHA256 of sole CORE action bytes, not a replacement signature or authorization.

State `PREPARED` includes awaiting merchant approval, signed-not-submitted, submitted/UNKNOWN and unverified proof. `ISSUED` requires independently finalized successful **terms registration**; it is still not payment. Only the underlying verified settlement/refund effects produce paid/refunded/net figures. The Cloud adapter preserves `Request` exactly and returns `InvoiceID`, stable `OriginalOperation`, `PREPARED|ISSUED`; Cloud keeps settlement `NOT_VERIFIED` as before.

## Original Wallet merchant approval

`apps/pay/native/merchant-invoice-approval.mjs` is Main-only. `createPrivateNativeInvoiceClient` calls only the configured original qualified private transport. `createNativeInvoiceMerchantApproval({main,pay})` uses the actual `DesktopWalletAuthority.requestPQTypedAction` and original `FileTransactionIntentStore`, decodes/encodes only through the normal SDK, and compares Main's independently selected account/network/nonce/message with the frozen Pay message. It returns the existing Main `approval-required` review. It never calls `approve`, imports custody, enables an experimental provider, or signs itself. Existing original Main UI/Auth/custody must approve the review and consume the exact ecdf-compatible Native library via normal SDK intake.

After that approval, `readOriginalMerchantMember(intentId, originalHash, current)` reads only the original retained Main record and extracts its complete public Member via the sole SDK transport codec. It refuses a replacement review when an original or unresolved preparation exists. Signing consent is not broadcast consent: the existing protected Main/Source submission flow must separately authorize sending that original Member to the Pay `merchant-member` endpoint. The Native Source's `register_terms` decision checks that current permission; a pasted Member or callback cannot grant it. The Main adapter's positive full Native approval remains gated by the actual normal SDK/Core14 namespace and protected Source intake; syntax/HTTP client controls do not claim an installed Main/C ABI run.

## Cold recovery and fences

The original encrypted Store captures the bill/terms/message before any signer runs, and captures a verified Member before original dispatch. An ambiguous submission never creates another signature or later nonce. Lookup can reconcile the same hash and repair the intent-to-original-journal link after a crash. If a crash occurred after Member capture but before `RegisterTerms`, lookup stays `signed_not_submitted`; it does not broadcast. Only a fresh original merchant submission with the same Member may advance it, through the original Source/send authorization and original single-dispatch CAS.

A nonce/epoch drift refuses the frozen review. It does not silently replan a bill that might already have a retained Main signature. Source revocation denies private responses even after remote work; public original archival remains recoverable. Concurrent same-bill creates retain one intent and perform no signing/broadcast. No balance table is added.

## Reproducible checks

The existing prepared composition includes exact unchanged CORE/LINK inputs plus the Cloud `internal/cloud` and `internal/developerauthority` snapshot recorded in P06 `CLOUD_NATIVE_CONSUMER_INPUT.json`. Run the original module entry with `YNX_PAY_NATIVE_OPTIONAL_TAGS=pay_cloud` to include the concrete Cloud interface. The real temporary-chain CORE fixture is reused; no new verifier or seeded paid state is introduced.

Validated together: actual private ctor/HTTP/Store, actual Cloud producer interface, merchant role and AND rejection before Member capture, one-bill immutable aliases, response loss/cold original lookup, pre/post-Register crash boundaries, independent source-bound product reader and exact CORE 100 payment/30 refund/70 net with real H/H+1 proofs. The concurrent request race found in JSON RawMessage buffer reuse was reproduced and fixed by decoding into a fresh capture. Main private HTTP client tests are loopback transport controls; real Wallet Native approval/install/deployment/funds are separate.
