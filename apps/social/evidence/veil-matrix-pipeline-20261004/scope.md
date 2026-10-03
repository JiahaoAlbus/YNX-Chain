# Dormant native Matrix pipeline candidate

Base: 51c7074028f599ac3c999eccdcd18dfb7fcbaf49.
No production bridge/factory, protocol activation, deployment or native install.
Root55cb admission is limited direct-envelope source and is NOT extended here.

Owned composition now connects independently admitted context resolution,
original protected Signal Outbox encryption, immutable context fingerprint and
Matrix transport journal in one native transaction. Public Matrix fields cannot
mint signal identity/epoch/generation trust. Resume checks the original native
context fingerprint and protected original ciphertext before upload/send.
Cipher is uploaded through the original pinned SDK session. UNKNOWN is committed
before sendRaw; returns only an event hint until original readback is matched.
UNKNOWN retries never create a new ciphertext, message or fabricated SDK txn.
Known SDK transaction is nullable consistently in native and TS pending views.

SDK original-event parsing follows current native admission first. It snapshots
original SDK data, rejects edited observations, validates exact V2 descriptor,
room/sender hints and bounded numeric fields; legacy wrapping requires original
SDK-decoded data and NEVER replaces native Signal authentication. Actual shape
and availability of original/latest SDK JSON remain runtime NOT_VERIFIED.
Existing legacy UI/readers are not modified/removed by this batch.

Receive composition requires a BoundedCipherDownload native implementation;
there is NONE supplied here. It must enforce resource limits during download,
not trust claimed media size or pretend eager unbounded getMediaContent is safe.
Native inner decrypt, claimed message-ID comparison and final admission checks
occur before atomic commit/plaintext release; candidate body is closed on outer
failure and cipher buffer wiped. OS/directory/anchor/grant producers remain
required, as do original Matrix route implementation and UI lifecycle routing.
These ports are incomplete owned/shared implementation, not user-secret asks.

Evidence: full project tsc0; strict emitted TS compile0; nine TS tests PASS.
Java adapters fresh release21 compile0;22 atomic-memory synthetic journal/context
assertions PASS. Kotlin2.1.20 JVM17 same-module fresh compile0 with original native
Authority/Transaction/Store sources, Matrix26.09.28 API and API36. First separated
module compile correctly refused internal access; retained, no visibility patch,
friend-path or disabled checking. Final authorization-before-event-read patch
recompiled0. Java cold compile/model check preceded that final Kotlin body-only
patch; original native storage ABI/source was unchanged. Both final bundles and
source/dependency SHA are retained, not labelled APK/IPA/OS or runtime proof.

Not verified: actual pipeline execution, streaming downloader, SDK upload/send/
sync JSON/readback/recovery, revoked device runtime, durable anchors, fresh SPQR,
PQXDH/full649/groups/history migration, backup/attachments UI, platforms/public,
three ordinary users and actual MONSTER. No account/sign/tx was requested.

Next: implement original native routes and bounded SDK media transport, native
activation/bridge wiring only after actual trusted producer admission, UI normal/
error/recovery, LegacyReader integration and actual platform/node/install tests.
Sole controller remains 接续测试网生态审计工作; no services stopped.
