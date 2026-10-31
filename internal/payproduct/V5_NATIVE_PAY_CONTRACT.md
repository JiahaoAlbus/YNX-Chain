# V5 Native Pay service module

This module extends the original Pay Service/Store/Server. Build tag: `pay_pq`.
It consumes CORE's sole `YNX-NATIVE-ACTION/v1` invoice codec, original N1 TX-BATCH Member and native-action transport. It does not introduce a payment wire or sign on behalf of a merchant/payer. The legacy `/v1` product descriptors remain separate.

## Normal service entry and authority

Construct `NewNativePayHTTP` with an explicit qualified HTTP client/Transport, then `NewNativePayService(originalService, NativePayConfig{...})`, then `originalServer.MountNativePay(service)` **before serving**. Supply independently configured genesis/nativeChainID, real `NativePayAuthority`, and independently anchored `NativePayProofSource`. The closed production daemon keeps these routes at 503 until its real Source owner wires these dependencies; environment flags and HTTP callers cannot create grants or trust anchors. A build alone does not enable this service.

`NativePayAuthority.Authorize` must authenticate the current real caller via the original Source/Auth session and bind its principal, current complete registered PQ pair/revocation/epoch, actual ledger nonce/height, short expiry and `Current()` revocation fence. For terms, it must check the actual registered merchant and approved bill/price and return the exact `BoundOrderID`, `BoundInvoiceID`, `BoundSessionID`; `Terms` or `Action.Payload` are untrusted requested values. An unsigned/raw Cloud bill is not approval. Optional `ProductMerchantID` must come from the real Source's registered Pay merchant-to-store mapping. Recipient/address equality alone cannot create that association. Missing grants return unavailable.

`NativePayProofSource.Trust` must independently supply the trusted engine snapshot, authenticated anchor, H/H+1 headers, exact original tx/index/hash expectation and time policy. Collector JSON cannot select these values. Pay invokes the actual CORE verifier and then validates the historical invoice prefix. No RPC `committed`, collector `collected`, signed terms or valid historical signatures alone produce a paid balance.

## Product HTTP contract

All routes are private and need the original current Source authority. Bodies reject duplicate/unknown/trailing fields. No route accepts private keys, grants, owner registrations or trust anchors. Money and heights use canonical unsigned decimal strings; binary fields use base64.

| Method | Route | Body / result |
| --- | --- | --- |
| POST | `/v5/pay/invoice-terms/review` | `{sourceOrder, terms}` → exact CORE signing bytes, owner/next nonce/fee; status `awaiting_original_merchant_native_signature` |
| POST | `/v5/pay/invoices` | `{sourceOrder, member}` → original retained operation; no paid claim |
| GET | `/v5/pay/invoices/{merchant}/{invoice}` | complete original Money metadata, terms Member/envelope/hash, operation identities and proof-gated financial projection |
| POST | `/v5/pay/invoices/{merchant}/{invoice}/review` | `{}` → exact original-payer settlement signing request |
| POST | `/v5/pay/invoices/{merchant}/{invoice}/settlements` | `{member}` → original retained settlement operation |
| POST | `/v5/pay/invoices/{merchant}/{invoice}/refund-review` | `{refundId, amountAtoms}` → merchant refund signing request; original payer derived from proven settlement |
| POST | `/v5/pay/invoices/{merchant}/{invoice}/refunds` | `{member}` → bounded original refund operation |
| POST | `/v5/pay/invoices/{merchant}/{invoice}/operations/{nativeHash}/reconcile` | `{}` → lookup original and independently verify; never resubmit |

`terms` has exactly these string fields: `invoiceId`, `sessionId`, `recipient`, `payer` (empty for CORE open payer), `assetId:"YNXT"`, `unitVersion:"1"`, `feeRule:"native-transfer-fee-one/v1"`, `keyEpoch`, `revision`, `amountAtoms`, `maxFeeAtoms:"1"`, `expiresAtHeight`. Expiry is execution height. Canonical IDs/accounts follow CORE; no legacy decimals18 conversion. `sourceOrder` must preserve the actual originating bill/order identity. Stable key is `(configured original genesis, canonical merchant account, CORE invoiceId)`; signed session and Source-approved order cannot alias another invoice.

Consumers must preserve the returned Member/envelope/native hash/ABCI hash and use original reconcile after uncertainty. Cold UNKNOWN never resends or rebinds a later nonce. Failed execution becomes `confirmed_failed` only with independent finalized execution proof; any new attempt still requires current Source and a newly authorized Member and retains old attempts. All settlement/refund totals and three fee categories derive only from proven CORE effects. The existing encrypted journal, audit and merchant webhook outbox retain original identity atomically.

## CORE and Native inputs

CORE base `d5fa3245ad14421e6acee6dc1962052f9e005d34` plus the exact owner overlay recorded in P06 `CORE_CONSUMER_INPUT.json`. Codec SHA256 `bcd011e971ee69d844c989c70ca20fedad804f7bdf28595e35bb982f73af23f8`; canonical fixture `internal/ynxauth/testdata/invoice-action-v1.json` SHA256 `d5895426311ef8f4eea003d1ec548834d92ea9100052a5eed2d3d0616dbbff9a`. The composition preserves these files unchanged.

Actual CORE HTTP paths are `/transactions/pq/actions/broadcast`, `/transactions/pq/actions/originals/{nativeHash}`, `/transactions/pq/actions/{abciHash}`, `/transactions/pq/actions/originals/{nativeHash}/pq-finality-proof`, `/invoices/pq/{merchant}/{invoice}`. No guessed aliases/fallbacks.

Coordinator supplied formal Mac Native producer `ecdf8073e9f2b03bbb8e8b8d6e9d1bf28673b6a3`, archive directories `/Volumes/西部数据/YNX-large-work/protocol/core-native-ecdf-20261031-r1/{tx,invoice}`, compatible archive tuple `11249400`, SHA256 `7382ac7d45bfcfa3cecde6cd37bec6befc7322ee878c4cf9f2b02537d7da3253`. The producer's C signing/Go AND results are supplier evidence; this Pay workflow uses temporary test keys and does not claim an installed Wallet or merchant Native signature. Main/SDK own intake of that exact tuple; old a59 is not invoice-qualified.

## Reproducible verification

From this checkout, with the prepared isolated composition and a dedicated public fixture directory:

```sh
internal/payproduct/testsupport/run_native_workflow.sh "/path/owners/P06/pq-core-composition-d5fa-invoice-v1" "/path/temporary-public-fixtures"
```

The exporter adapts CORE's actual four-validator BlockExecutor test fixture only inside the isolated composition. Both account registrations, invoice schedule, terms/settlement/refund, H/H+1 dual-PQ commits and result proofs are real temporary-chain executions. Temporary keys are destroyed, never exported. Pay independently loads the original engine snapshot and authentic anchor, prepares the same sole CORE messages, verifies the real proofs, recovers a lost-response UNKNOWN cold, reads payment100/refund30/net70 and fee1 per action, rejects substituted headers/excess refunds/revoked reads. It never seeds Pay paid state or replaces a verifier. The script runs affected product/gateway checks and actual closed daemon entry. This is temporary-chain/service integration evidence; public network activation, real Source qualification, installed client and real funds remain separate gates.
