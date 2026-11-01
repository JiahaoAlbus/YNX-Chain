# Native Pay business client

This client consumes the original private Pay service and P01 Wallet Main. It owns no signer, approval, second transaction journal or balance. P01 owns actual signing/broadcast review, Native custody, original journal, fixed submission target and UNKNOWN. P03 IDE has no Pay handoff at its checked `7ff73199` source.

Historical P01 `a437d525a7d35d31a9ef664629433bcaa1df4901` first supplies `requestPQPayBroadcast(reference)`: terms exactly `{hash,kind:'invoice_terms',intentId}`; settlement/refund exactly `{hash,kind,merchant,invoiceId}`. `hash` is the retained ABCI envelope hash. No URL, amount, nonce, capsule or approval input is accepted. The existing separate Wallet broadcast approval remains required. That frozen control refuses `PQ_PAY_BROADCAST_SOURCE_NOT_SUPPLIED` before custody/queue/journal mutation because its genuine Native Source is not supplied. A callable review method is not executable payment. The older deae evidence had three queued reviews and zero dispatches only.

`createNativePayMainEntry({getMain,getContext})` is boot-only composition; its Source is never supplied through IPC or environment. Connect only `invoke/status/cancel` to the original safe live-frame IPC. Strict DATA inputs include invoice/intent lookup, terms/payment/refund review, events, original recovery and broadcast-review. The controller reads original retained Members, checks both hashes/account/operation/kind and calls only P01's Pay-specific review. It never falls back to Core's `requestPQBroadcast`. `terms-submit`, `pay-submit` and `refund-submit` compatibility commands also request this review only: the client has no approve/send operation and no `withSubmissionApproval` callback.

After the SAME original Main finishes an approval/rejection and its cleanup,
call `entry.settleOriginalReview(id, originalMain)` locally. Do not expose this
completion notification as IPC. It checks the stored Main identity and that the
request is absent from its actual `pendingRequests()`. `cancel()` also prunes
normally settled requests before rejecting still-pending ones. Unexpected reject
or pending-reader failures keep their first cause and bookkeeping debt; they are
not repeated or silently cleared because an id vanished. A later actual Main
completion notification can release that local debt. No transaction, original,
UNKNOWN, approval, payment outcome or Native resource is removed by bookkeeping.

`product-source.mjs` is the complete normal-boot consumer. Main imports
`composeNativePayProductSource(entry, {acquireOriginalProductSource,isOriginalProductSource})`
with factories from its admitted original namespace, or adopts the result of
`openNativePayProductSource` before calling `entry.compose`. Main retains any
thrown `error.partial` before interpreting the cause. A recognizer/factory is
an actual Auth/SDK owning-code dependency, never an IPC/ENV callback or boolean
grant. Wallet's three Member POST/two GET scope cannot authorize product
create/lookup/review routes or manufacture historical invoice originals.

The consumer holds the original loan across every read and preparation call,
checks both its original current fence and the caller's fence before/after the
await, and passes the combined guard to the actual private transport. Parent
retirement calls `retire`, awaits `join`, then `close` and `assertSafeToClose`.
Active reads are cancelled and drained first. An uncertain close retains the
same loan and first cause and is never repeated. An unrecognized partial is
retained without invoking its methods. `status().SourceAdmission` is always
false; ready ports alone cannot grant authority.

The `pay` facade exposes only original preparation/review/read/reconcile
methods; all signed-Member dispatch stays in original Main. For `shop.order`,
`readOriginalShopNativeInvoiceRequestDATA(orderID,current)` borrows the actual
Shop supplier; actor/role remain internal to it. For `cloud.ide-usage`, the
original `readOriginalCloudBillLocator(ref,current)` supplies the known
`{selection,utcDay}` to the actual Cloud client's `nativeInvoiceIntentOriginal`.
The consumer checks the original reference and retains its complete bill,
manifest and full project Ref envelope, available through
`readOriginalProductEvidence(ref,current)`. It never derives a locator by
parsing/scanning BillID, computes a new price, or promotes DATA to Source.
Missing product getters block only that product read; original invoice reads
remain available under their own current Source.

The existing authenticated invoice GET now supplies `termsMessage` as original
stored signing bytes with its stored hash checked, preserving UNKNOWN and all
existing money status. The private client `readInvoiceOriginals(ref,current)`
can read these original terms for payment review. This remains a consumer of
the genuine ProductSource's qualified transport/current. Refunds still require
the remote payer's actual retained review/original context from its real archive;
the client returns `NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE` rather than
inventing a review, operation ID or historical snapshot from the Member.

The original runtime supplies:

- `pay`: the fixed `createPrivateNativeInvoiceClient({origin,requestPrivate})` consumer over the original qualified Source/LINK transport, with no default fetch, target override, redirect or dispatched-POST retry.
- `main`: the original P01 review object and its original `transactionSender.submissions.intentStore`; never a replacement journal or signer.
- synchronous `current()`: original local lifecycle/current fence, returning undefined while current and throwing after retirement/account/session/epoch change. Native authorization/recheck remains independently required.
- `readOriginalInvoiceIntent({productId,sourceOrder},current)`: original retained product request DATA, read from its existing order/bill/journal. Missing actual port is `NATIVE_PAY_PRODUCT_ORIGINAL_UNAVAILABLE`. It cannot reconstruct a price/approval from current catalog data or grant Source authority.
- `readInvoiceOriginals(reference,current)`: retained terms and the payer's original settlement review/Member/public snapshots for refund. Terms review uses no invented originals. Missing archives close only that review.
- optional notification inbox/scope and original-product read ports described below; optional `close()` closes owned resources without taking over borrowed Main/Source lifetimes.

Normal intent creation takes only `{action:'create-intent',productId,sourceOrder}` from the renderer; lookup uses `lookup-intent` with the same reference. The complete Source-owned request is detached and bounded, checked against the original operation/Money terms, and sent once to the existing prepare-only endpoint. It never signs or broadcasts a Member. Lost creation acknowledgement uses only the original request lookup in a cold client. The originating product's existing journal keeps the attempt and original request; no second local transaction table or automatic recreate is introduced. PREPARED and ISSUED never mean paid. Source503 `NATIVE_PAY_AUTHORITY_UNAVAILABLE` and request409 `NATIVE_PAY_REQUEST_REJECTED` preserve actual code/status/path. Wallet provider `data.code` is shown instead of outer numeric4100.

Original Main's fixed raw-packet methods are:

- `submitMerchantMemberPacket(intentId,member,current)` → POST original intent `/merchant-member`.
- `submitSettlementPacket(merchant,invoiceId,member,current)` and `submitRefundPacket(...)` → the original invoice's `/settlements` or `/refunds`.
- `readInvoiceIntentPacket(id,current)` and `readInvoicePacket(merchant,invoiceId,current)` → fixed GET only, no body, Member or reconcile POST.

All return exact `{method,requestPath,status,contentType,cacheControl,body:Uint8Array}`. They fence before dispatch and pass that guard to the original transport. They do not parse or post-check current before Main retains the complete original packet; a late lock must not discard the first result. Body bytes are detached and bounded at2MiB. Main reserves UNKNOWN before one Pay POST, saves the first full packet before parse/completion/cleanup, retains first cause and never retargets a Core UNKNOWN to Pay. GET stays raw DATA/UNKNOWN; it cannot be relabelled POST/Core.

The sole SDK `5aa1a6596885c31138e7825c111b6ce1c81ed8ef` supplies public `@ynx-chain/wallet-auth/pq-native-pay-observation.inspectPQNativePayResponseDATA(snapshot,{member,originals},target,response)`. Terms target is exactly `{intentId}`; settlement/refund target `{}` derives its route from the original Member. Main passes its retained POST packet unchanged, including actual `/v5/...` metadata and `cacheControl:'no-store'`. The result is observation-only UNKNOWN with paid/submitted/permission/finality/retry false. It is not Native approval, and it does not accept GET. Complete553-member archive,9966-file prefix and root6/full2 mapping must be consumed together.

Auth's BFT Go `Owner.InvoiceReader()` already implements `payproduct.NativeInvoiceSourceReader` for the cloud-bill Source. Its current family/recheck is `cloud.ide-usage` only. That is distinct from Main's missing Native submit getter/recognizer or Shop's missing joint order/store/registered merchant/approved-price reader. These are owning CODE gaps; JSON cannot widen the cloud-bill family. Genuine Root/merchant/current/independent proof anchor and user approval remain separate gates. Native engine account-read capability does not imply invoice submission or BFT proof support.

Notifications use `NativePayNotificationInbox` with an explicit owned private SQLite path. `readNotificationScope()` returns the real Source/principal/genesis/binding/current; `refreshOriginalProduct(event,current)` performs original Cloud/Shop lookup only and returns `{sourceOrder,queryOnly:true}`. Missing readers retain pending references. Events never create/reprice/pay/refund, grant authority, confirm money or replay UNKNOWN. Confirmed effects and paid/refund/net projections remain the original Pay service's independently verified Core H/H+1 responsibility, with `clientIndependentFinality:false` in this client.

`node scripts/build-qa.mjs /absolute/new-output` packages eight source modules and the exact Node/libnode inputs. `--mac-app` uses the existing SwiftUI shell; `--main-runtime-manifest` accepts only a complete original owner-pinned JavaScript IPC bridge. Defaults remain accurately unavailable. These builds are not Source admission, a matching Main/SDK/Native whole image, installation, deployment or merchant acceptance. Preserve prior installed candidates and UNKNOWN; never hot-update a frozen app.

New focused evidence covers actual original Go private factory/Store with the Node consumer: one creation lost acknowledgement, actual HTTP drain before cold Store reopen, cold lookup/read only, and Source503. The P06→actual P01 a437 case reaches the genuine missing-Source refusal for all three kinds, with zero custody/dispatch and unchanged signed-unsubmitted originals. SDK data/member evidence is reused rather than rerunning old math matrices. Older funds workflow controls use explicit PUBLIC backend fixture dispatch and cannot stand in for real Main approval or Native custody. Full dispatch contract: `internal/payproduct/V5_MAIN_PAY_DISPATCH_CONTRACT.md`.
