# Dormant native Matrix transport journal and pinned-SDK primitives

Base source: 981f1c4ef8465ba1206e12202bfd74ea098b21b6.
No shared/Chain/Host path or production bridge registration changed.

VeilMatrixJournal uses the original protected OUTBOX Signal VOB2 record; it
compares sender UUID/type/cipher bytes and stores transport metadata separately
under matrix-v2:local-operation. Preparation must be invoked in the same native
transaction as independently admitted Outbox encryption. Matrix routing Scope
and its recheck are NOT crypto trust; outer orchestration must independently
resolve the crypto context and review the actual original Matrix handle.
No default native factory/provider or real admission is supplied by this batch.

Journal phases PREPARED -> MEDIA_READY -> UNKNOWN -> OBSERVED retain original
operation and ciphertext identity. UNKNOWN is persisted before SDK send; retry
cannot reset it. SDK transaction identity is genuinely nullable until observed,
not invented from sender/local UUID. Exact original media reference and event
are required; changed mappings refuse. Missing original or corrupt journal
requires recovery. No delete/reset/re-enrollment is provided. Final guards are
registered with original native transaction or explicit QA commit-guard port.

Fresh javac release21 compile0 and17 atomic-memory assertions pass, using a
synthetic opaque cipher/VOB2 fixture. This is NOT actual SessionCipher, Android
SQLite/Keystore, durable-anchor, crash or network proof. NativeStore and other
production adapter bytecode were inherited from55cb, with exact SHA binding.

VeilMatrixSdkCalls compiles with actual pinned Matrix26.09.28 Android API+API36
against Kotlin2.1.20/JVM17. Room.sendRaw(content=...,eventType=...) uses named
arguments checked by the actual SDK Kotlin metadata; no positional name guess.
Client.uploadMedia uses original SDK session and application/octet-stream, only
cipher bytes. SDK calls are wrapped with native caller rechecks and retain
UNKNOWN on error. No real SDK upload/send/sync or account operation was run.
Descriptor is built from native journal via platform JSONObject, not raw JS.
Bytecode is retained as binding evidence, not network execution evidence.

SDK raw-send exposes no caller transaction argument; a real journal must not
invent one. The earlier TS pending formatter still requires known SDK txn and
is not hooked to this nullable native journal. Bridge/consumer alignment is an
explicit next integration item, not hidden as already usable.

Pending production: independently admitted CryptoEngine+Matrix route mapping,
original native protected store/final anchors, durable native orchestration and
unknown-event readback, ciphertext download/digest/inner-envelope verification,
JS/UI receiver/LegacyReader integration, groups/fanout/history/platform/public
and actual MONSTER/user gates. Protocol remains inactive. No deployment or
eth_requestAccounts/sign/send occurred. Root owns shared/OS runtime scheduling.
