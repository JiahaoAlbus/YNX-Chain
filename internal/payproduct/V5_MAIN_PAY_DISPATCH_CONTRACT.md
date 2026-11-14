# Native Pay dispatch contract for original P01 Wallet Main

Current owner is P01 Wallet Main. Its historical complete SDK7a normal boot baseline is
`6ef63d5a8ba56fe3df4caacf3e034feba5d43f4d`, followed by the product-entry
integration in `e6f9c8573afc0d1571a5e7ac4017583714de9889`. Original review,
once-dispatch, durable UNKNOWN, first-response custody and native retirement
are implemented; they are not installation or genuine Source admission proof.
The later supplied complete Main is `f68dfda85b987c9a8e42d15a7acc589e80a88c97`
with SDK8ed, actual namespace six-export adapter and Rootloader pin. Their
supplied code is not a missing ABI; current original Root/resource admission,
matched Native whole and installation remain independently unproven. The
earlier frozen controls remain historical evidence.

P06's production Native capture/channel/request implementation has passed actual
Auth SourceLease→Go→private Unix component controls and normal c-archive strong
linking. Its PUBLIC Root boundary does not qualify the real Main/Root source.
Normal Root profile creation, same-process registered client startup and the
same already-booted Main namespace remain original Auth/LINK/SDK dependencies.
The normal product controller additionally needs a genuine ProductSource, its
original bill/order and invoice archive getters, and qualified preparation/read
transport. Wallet7a Member POST/query scope cannot be widened to supply them.
P06 owns its actual consumer/runtime glue and service-original integration;
Auth/SDK own genuine native qualification and original product owners supply
retained source data. Callbacks, a codec, a package or HTTP 200 grant no Source.

The original Main notifies `entry.settleOriginalReview(id, sameMain)` only after
the real review/cleanup completes. It is Main-local, never renderer/IPC input.
The controller checks actual `sameMain.pendingRequests()` before retiring local
bookkeeping; cancellation skips resolved ids and rejects only live ones. Failed
cleanup keeps its original cause until real Main completion is observed.

The production caller is `NewRegisteredNativeInvoiceIntentSource(parent, actualJointReader)` and `NewPrivateNativePayServer(parent, NativePayConfig{Genesis,NativeChainID,HTTP,Authority,ProofSource}, registeredSource,build,logger)` in `pq_intent.go` / `pq_intent_source.go`. These are existing in-process dependencies. An HTTP JSON body, UI input, SDK codec, signed Member or build manifest cannot construct Source authorization. Missing actual Source closes the relevant action. P01 must extend and preserve its existing `requestPQTypedAction → requestPQBroadcast → executeOriginalPQBroadcast → createPQTransactionSubmission` chain, actual queue/UI/capsule/Auth/current and original journal. This is not a new approval or transaction state machine.

## Exact existing request routes

| Action | Original route | Request body | Successful body |
| --- | --- | --- | --- |
| invoice_terms | POST `/v5/pay/invoice-intents/{intentId}/merchant-member` | `{member:base64(full original Member)}` | `NativeInvoiceIntentView` |
| invoice_settle | POST `/v5/pay/invoices/{merchant}/{invoiceId}/settlements` | same | `NativePayOperation` |
| invoice_refund | POST `/v5/pay/invoices/{merchant}/{invoiceId}/refunds` | same | `NativePayOperation` |

`intentId` is the original server-generated `npi_` plus 48 lowercase hex digits, persisted before review. It is not inferred from a signature or new bill. `merchant` is the canonical `0x` plus 40 lowercase hex account; `invoiceId` is the original Core invoice ID. Terms derive both from the original action/intent, settlement merchant from its original action payload, refund merchant from the original action owner. Do not accept a caller-supplied target URL or account/nonce override. Before dispatch Main's existing retained review/full dual-AND Member/envelope inspection still binds both original snapshots, account/network, operation ID and hashes. The sole SDK codec remains `@ynx-chain/wallet-auth/pq-native-action` and `/pq-action-transport`.

The Pay-owned original private client at `apps/pay/native/merchant-invoice-approval.mjs:createPrivateNativeInvoiceClient({origin,requestPrivate})` now exposes the concrete normal dispatcher callees `submitMerchantMemberPacket(intentId,member,current)`, `submitSettlementPacket(merchant,invoiceId,member,current)` and `submitRefundPacket(merchant,invoiceId,member,current)`. They use the same constructor-pinned origin and original authenticated Source/LINK transport, with exactly one POST, no redirect/default fetch/credential/retry. `current` is a synchronous actual guard, never JSON/boolean. It is checked before dispatch and passed to the original transport to fence its actual write. The backend separately checks its original native Source submission authorization. No client approval is substituted for backend Source.

## Real response DATA and custody

These packet methods return the original `{method,requestPath,status,contentType,cacheControl,body:Uint8Array}`; body is detached before return. All HTTP refusal statuses remain actual response DATA, not a thrown/relabelled Core receipt. There is deliberately no post-response current check before original Main captures the packet: a late lock must not discard the result. Main persists the complete original response before parsing, completion or cleanup, retaining first cause/UNKNOWN if parsing or storage fails. The original `/v5/...` requestPath remains unchanged. The existing Core-only typed parser cannot consume it as `/transactions/pq/actions/broadcast`; the sole SDK/Main owners must handle this Pay response branch explicitly. Do not fabricate a Core method/path/status/effect or inherit Core finality.

`NativePayOperation` fields are `merchant,invoiceId,nativeHash,abciHash,member,envelope,kind,owner,status,failure?,observation?,effect?`. Member/envelope are retained full base64 bytes. `nativeHash` is the exact full Member hash, `abciHash` the canonical original envelope hash, and they are distinct. Status `unknown`/`submitted`/`confirmed_failed`/`confirmed` describes the original Pay operation. A Core RPC observation, HTTP202, `submitted`, or callback is not paid or independent finality. `NativeInvoiceIntentView` has `intentId,originalOperation,request,state,phase,merchant,terms,signingMessageHash,termsNativeHash,termsAbciHash,invoice?`; `state` PREPARED or ISSUED never means paid. The same `originalOperation`/intent ID survives all stages; terms hashes are populated later and do not replace that product operation.

Private error bodies are `{code,error}`. Existing `nativePayError` returns503 NATIVE_PAY_AUTHORITY_UNAVAILABLE for missing current authority; other rejected requests409 NATIVE_PAY_REQUEST_REJECTED; strict framing may refuse400/413/415. None of these are proof that a prior uncertain operation never executed. Save the actual response first, fail closed, query the same operation.

## UNKNOWN and query-only recovery

Main creates its existing durable UNKNOWN marker before the one Pay dispatch, under genuine separate broadcast approval. Do not first send Core and then post Pay. A prior Core-target UNKNOWN must keep its original target and be queried there; it is never migrated, retargeted or resubmitted through Pay. New Pay-target originals must retain the original source-bound target association as Main-owned metadata without changing the signed wire or inventing another transaction table.

Terms use GET `/v5/pay/invoice-intents/{intentId}` and POST same path `/reconcile` with `{}`. Settlement/refund use GET `/v5/pay/invoices/{merchant}/{invoiceId}` and POST `/v5/pay/invoices/{merchant}/{invoiceId}/operations/{nativeHash}/reconcile` with `{}`. The latter invokes only original read/proof reconciliation; no signing or new send. Missing hash/link before the first send remains prepared/signed-not-submitted; recovery does not query-trigger a broadcast. NativePay RegisterTerms/movements persist the exact Member/original operation before dispatch and refuse replacement/automatic resend. The existing original event/outbox feed remains separate.

Only the original Pay service's independent Core H/H+1 verifier with actual `NativePayProofSource.Trust` and exact invoice effects/history can produce authenticated Pay paid/refund/net projections. Main's submission parser should record Pay handoff/UNKNOWN as observation only, keep `canRetry:false` and `consensusFinality:false`; Pay receipt authority must remain identified separately from any Main independent finality claim.

## Normal entry and ownership

The production `apps/pay/native/product-source.mjs` consumer is part of the
complete eight-module P06 projection. Original Main normal startup imports
`composeNativePayProductSource(entry,factories)`; factory names are
`acquireOriginalProductSource` and `isOriginalProductSource`, supplied only by
the admitted original namespace. This is a consumer contract, not a Native
qualification implementation or an extra approval. Missing actual producer
blocks ProductSource admission, never unrelated Main boot or source work.

The held original loan supplies synchronous `current`, original `pay` client,
and `retire/join/close`. The consumer forwards combined original/caller current
to all preparation/review/read calls; raw signed-Member POST methods are absent
from its facade. Parent adopts nonnull `error.partial` before the error status,
retires once, drains active reads before join/close, and preserves failed close
as UNKNOWN without repeating it. Unrecognized partial methods are not called.
No external callback, public test recognizer, CodeRoot, locator or status can
mint ProductSource authority; `SourceAdmission` remains false in its status.

Shop's source-owned `readOriginalShopNativeInvoiceRequestDATA(orderID,current)`
keeps actor/role internal and reads the retained original eleven-field request.
Its actual normal Unix export is independently supplied by P07. Cloud's
source-owned `readOriginalCloudBillLocator(ref,current)` returns its known
selection/day; the consumer calls the actual original Cloud client's
`nativeInvoiceIntentOriginal` and retains the complete `{request,original,
originalSHA256}` envelope only after exact reference/request checks. It never
encodes a new sourceOrder, scans for a bill or reconstructs a price. Missing
that getter affects only the corresponding original-product action. Existing
stored-terms GET supports payment review; refund requires the payer's actual
retained original settlement archive and otherwise remains unavailable.

The original `run_native_workflow.sh` includes the new consumer controls.
`product-source` runs the focused normal-entry/lifecycle/refusal delta;
`product-source-cloud` requires the complete verified original Cloud closure
and runs actual import plus HTTP/current controls. The prepared external Cloud
fixture adds only `TestP06ProductSourceActualCloudColdAndRevoke`, using P06's
actual consumer/client through the real normal Cloud HTTP/Store, cold reopen
and original Source revoke. `product-source-cloud-service` runs that new Go
case. `product-source-shop-service` runs only the new P06 consumer through the
original LINK registered caller, actual Unix getter and cold original Shop
Store, then original authority revoke. Preparation scripts freeze each whole
supplier closure externally and add only the declared test fixture. Source,
price and runtime setup remains explicitly PUBLIC; reads cannot grant Native
admission or merchant approval.

Pay `apps/pay/native/main-entry.mjs:createNativePayMainEntry({getMain,getContext})` is Main-boot-only composition. It reads the original Source/current and actual Main journal, enters the existing Main signing/broadcast review queue, returns sanitized bill/review references, and exposes no approve/key/sign/submit/Source construction operation over its input. `compose` is not an IPC or environment activation. P01 alone connects its existing safe live-frame IPC/normal UI and dispatcher. P06 now requires the fixed `requestPQPayBroadcast(reference)` review entry, as actually frozen by P01a437; its missing Native Source remains accurately unavailable. It never falls back to Core review or invokes a supplied approval/send callback. The compatibility submit commands also request this review only. Terms merchant/invoice references come from the actual retained terms action, not caller money or a URL. Pay's macOS client extends the existing package builder; missing original bridge/runtime is explicit unavailable, not a synthetic login or demo. Source/SDK/Main and actual same-source installation/admission remain distinct evidence.

P01 has selected the exact owning entry shape: terms `{hash,kind:'invoice_terms',intentId}`; settlement/refund `{hash,kind:'invoice_settle'|'invoice_refund',merchant,invoiceId}`. `hash` is the original retained ABCI envelope hash, not a new target or caller approval. No URL/amount/nonce/capsule/approval field is accepted. This shape is implemented by P01a437; actual dispatch still requires normal boot/once-controller, the supplied sole SDK Pay parser and genuine Native Source. P06 consumes these exact field sets and does not send all fields in one generic object.

P01 review routing is now actually frozen at `a437d525a7d35d31a9ef664629433bcaa1df4901`, parent deae, with HANDOFF SHA256 `50faaba141c6c9f43d31138ca9c1e91418329778e0b5630f49fe15fdb5eabec1`. The specific method exists; its default Native Source remains null and rejects `PQ_PAY_BROADCAST_SOURCE_NOT_SUPPLIED` before custody/queue/journal mutation. Current P06 consumption reaches that actual callee with all three exact references; it no longer diagnoses a missing method for this version. The older deae missing-method case remains predecessor-only. Main normal boot/once-controller and genuine Native Source still require their own executable qualification. Wallet provider `data.code` is preserved for UI instead of its outer numeric4100.

The two new original UNKNOWN query callees are `readInvoiceIntentPacket(id,current)` and `readInvoicePacket(merchant,invoiceId,current)`. They send only their fixed GET route with no body, no reconcile POST or Member; they return the same six raw fields without JSON parsing or a post-response current check, so Main stores its first exact packet before later failure. SDK5aa Pay inspection accepts POST only; GET remains raw DATA/UNKNOWN and must never be relabelled POST/Core. Read-only Native acquisition uses the original owner's query contract, not a fabricated approval capsule.

The sole SDK parser is now supplied in complete SDK `5aa1a6596885c31138e7825c111b6ce1c81ed8ef`: `@ynx-chain/wallet-auth/pq-native-pay-observation.inspectPQNativePayResponseDATA(snapshot,{member,originals},target,response)`. Terms target is exactly `{intentId}`, settlement/refund target `{}`; the sole codec derives merchant/invoice paths from the original Member. Main first retains actual six-field packet, then passes it unchanged. It returns observation-only UNKNOWN with paid/submitted/permission/finality/retry false. Complete553-member archive,9966-file prefix and root6/full2 mapping are consumed together; no few-leaf hotmix. This public DATA parser is not the missing Native approved Source getter/recognizer and cannot grant a payment.


## Invoice query size and cumulative refund acceptance

Ordinary invoice GET and the nested invoice in intent GET retain every exact
operation `member`, hashes, kind, owner, status, failure and verified effect.
They omit repeated per-operation `envelope` and collector `observation`.
Top-level original `termsMember`/`termsEnvelope` remain. Wallet refund review
continues to compare the retained settlement Member with
`operations[settlementNativeHash].member`. The journal, authenticated original
archive route, independent proof expectations, and direct action responses
retain their complete original contracts. Existing 1 MiB Product / 2 MiB Go
response caps remain unchanged; five actual operations fit below 1 MiB.

The existing isolated CI runner adds `multi-refund-fixture`, `multi-refund` and
`shop-multi-refund` selectors. The first exports a new temporary-chain fixture
using the original Core BlockExecutor/history query/H and H+1 verifier; it
never overwrites a retained fixture. The latter two enable the explicit `pay_multi_refund` test tag, leaving the
existing three-row full-suite requirements unchanged. They consume five
originals: terms, payment100, same-block refund30/index0 and refund20/index1,
then refund50. The Shop selector requires the original P07 driver binary and
SHA256, follows its normal prepare/confirm/return path, cold-opens after each
refund, and observes cumulative30/50/100 with net70/50/0. Separate goods receipt
and explicit restock follow full financial refund. Receipt stages perform no
Core calls or money POSTs and leave Pay disk bytes unchanged. PUBLIC fixture
Source/key setup is not genuine Root admission, installed Main acceptance,
mempool acceptance of sequential same-block nonces, or real funds evidence.

The multi-refund Pay cold/proof case runs with race detection. The two-process
Shop journey runs the normal Go target under the original unchanged 20s Shop
client budget. Its first full race-instrumented attempt timed out on the final
four-receipt GET; that failed log and original Shop state remain separate.
Normal execution completed the full journey in17.543s; this is not a claim that
the full instrumented journey passed. No retry of that uncertain original
Shop action, larger timeout, cached trust or skipped verifier is introduced.
