# Wallet native Pay client selection DATA

Purpose `wallet-native-pay-client-source-v1`, selection key `walletNativePayClientV1`.
Node DATA helper, not a mobile bridge or Native callee. Original SourceV2 domain,
registered N=1 mathematics and independently pinned signature-contract frames are
unchanged. No default frame, Root, source selector or approved release is created.

Selection field: `{version:1,protectedResourceRef,bindings:[{binding,operations,untilMs}]}`. Nonempty,
at most 64 rows, exact fields, no duplicate complete Binding. Profile window is
the original SourceV2 maximum 24h; every selected row must still be live. Current
head is SHA256 of the sole canonical selection DATA; current expiry cannot exceed
the earliest selected row. The existing original current generation, sequence,
floor, nonce, subject key revision, retirement and registration gates remain.
No floor or generation is invented here.

Binding6: `networkId,account,hash,memberHash,operationId,target`.
Target7: `version,service,kind,intentId,merchant,invoiceId,requestPath`.
Version numeric 1; service `pay`; wire kind invoice_terms/invoice_settle/invoice_refund. invoice_terms intentId is
`npi_` +48 lowercase hex, other kinds require explicit null. Merchant and invoice
are always required; invoice_terms/invoice_refund merchant equals account. Target requestPath is
the original POST path even when selecting a read. Network is bare64hex; hashes
are `0x`+64hex SHA256 of original complete envelope and original Member separately.
Never parse/re-encode either original before hashing. OperationId is original,
nonempty UTF8 <=128 bytes, without controls, not minted by this module.

| Operation | Verb | Path | Protected purpose |
|---|---|---|---|
|post_terms|POST|/v5/pay/invoice-intents/{intentId}/merchant-member|invoice_terms|
|post_settlement|POST|/v5/pay/invoices/{merchant}/{invoiceId}/settlements|invoice_settlement|
|post_refund|POST|/v5/pay/invoices/{merchant}/{invoiceId}/refunds|invoice_refund|
|get_intent|GET|/v5/pay/invoice-intents/{intentId}|pay_query|
|get_invoice|GET|/v5/pay/invoices/{merchant}/{invoiceId}|pay_query|

GET selects the original effect custody; it does not approve, sign or send its
Member. The operation inspector accepts owned plain Uint8Array public originals
only, and produces route/binding DATA, never a transport callback.

Generic policy adds the already-existing explicit applicationId/productId/platform
fields; productId must be wallet, platform is the existing native Node desktop
linux/macos/windows closure. This does not supply an iOS/Android/Hermes bridge.
Profile selection uses the existing association, expectedRequest, host state path
and private-terminal path plus the one dedicated key. Actual values must come
from independently reviewed release/source rows, never caller assertions.

Not supplied: immutable Main qualified selector; Auth Root/native SourceLease
issuer/current+native retirement epoch; current registered owners/release rows;
actual authorized issuer/current custody and durable Source resources. Normal
issuer/current CODE dispatch is included, without creating release entries.
Auth/Main retain these write sets. Existing Source4/catalog/server Pay family
cannot substitute. All result authority/SourceAdmission/NativeAdmission/registered/
approval flags remain false. No real account, keys, transport or payment tested.

Run only the new controls/types via `node scripts/ci/wallet-pay-client-source.mjs`.
Parent owns package/export/workflow integration; this delta does not publish them.

The required protectedResourceRef is a stable independently reviewed resource key
(1..128 ASCII token characters A-Z/a-z/0-9/._:-, starting alphanumeric), not a
path, hash of this profile, transport tuple or Root grant. It is signed inside
the sole canonical selection. Only the genuine Auth RootSource Ref may resolve it
to its retained readonly protected profile BEFORE SourceLease creation and
registration borrow (bootstrap must not call a Runtime getter that depends on
that lease/registration): socket/service/peerUID/peerPID and
enabled exact routes. SDK has no resource setter/resolver/callback. Root-approved
resource row producer and actual RootSource getter remain NOT_SUPPLIED here. LINK ANDs
the original P06 route constraints with that actual profile. No cross-kind POST
can be selected, and read-only acquired loans permit just the corresponding GET.
Auth enum indices 0/1/2/3/4 are operation IDs, never route counts.

Wire kinds are the exact Auth NAPI parser/emitter values at pay_native_stage.cpp:29/30. Internal C++ Kind::terms/settlement/refund are rejected, never aliases or normalized.
