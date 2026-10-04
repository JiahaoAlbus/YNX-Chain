# Actual native SDK cold-record ratchet pipeline, 2026-10-04

Base source: ccd57a684786b1665165a2677db4247e9b686795.
Base tree: 3967385eff11a85928c2064a68825e7389154321.
Controller: 接续测试网生态审计工作. No deployment or device operation.

## Original result retained

The first driver omitted the original independently verified application-context
producer. It compiled successfully and failed with
VEIL_APPLICATION_CONTEXT_UNAVAILABLE before the first send. This is the ORIGINAL
production guard working, not an SDK cryptography defect. original-run.txt and
original-inputs.sha256 retain that failed driver/actual output.

The corrected driver uses the existing VeilEnvelopeCheck.Port commit-guard and
atomic-memory fixture and an explicit synthetic directory context, with generations
and epoch set to 1. Public pins are established from separately generated test peers,
not request metadata, SSO, classic Wallet keys or parsed ciphertext. This is an
engineering fixture, NOT real identity admission, provenance, or revocation authority.
The original application source is not modified and missing-authority refusal is
also asserted in the corrected run. No direct SessionCipher send/receive fallback.

## Actual execution

- Official pinned libsignal-client-0.104.0.jar bytes SHA256:
  c2b415784ea95b6552a87bea4b644d1f5178142cb7cc4113c0b2c68a35c43ec9.
  This checks admitted binary identity only; upstream build/source provenance and
  distribution/licensing approval remain NOT_VERIFIED / NOT_APPROVED.
- Actual current Java engine sources compiled with release21 against the original
  API36 compile jar and existing 13-kind native-port compilation output.
- The reused Kotlin port artifact came from the original native-adapter.9DIt5P
  compile associated with source 3b902974. Original input hashes and artifact SHA
  are retained. kotlin-changes-since-port-source.txt records no subsequent Kotlin
  source changes. This is not a fresh platform Gradle build or an installed module.
- Real embedded JNI was used with -Xcheck:jni; no crypto method substitution.
- Result: 307 assertions, 74 encrypted messages, 74 nonempty actual getPqRatchet()
  fields, 66 distinct actual sender curve ratchet public keys.
- A signed curve + KYBER_1024 PreKeyBundle bootstrapped the original SDK store;
  successful original inbox receive consumed actual one-time curve and KEM records.
- 32 alternating bidirectional rounds succeeded through original authenticated
  envelope, outbox, session-store and inbox code.
- Seven retained outgoing messages were received in order 6,0,4,1,5,2,3 after new
  peer/store objects reconstructed identity and session/outbox records from copies.
- An exact receive retry retained plaintext without modifying the committed records.
- Real ciphertext tampering raised actual InvalidMessageException, rolled back the
  controlled store and returned no message; original ciphertext and a later reply
  still succeeded.
- Java24 native-load deprecation warnings are retained, not suppressed. This is not
  a console0 claim or a warning-free production runtime claim.

## Limits

Cold reconstruction means newly constructed SDK/store objects over serialized
record copies in the SAME JVM, not process death, real SQLite disk recovery,
checkpoint-CAS atomicity, rollback-safe backup restore or OS-device recovery.
The reused memory fixture is not a durable transport or trusted native authority.
Nonempty PQ fields plus changing curve keys do not independently certify the
complete Triple Ratchet/SPQR lifecycle, all PQ state transitions, interoperability
with another implementation, or all stated crypto649 invariants.

No actual Matrix homeserver/relay, real user identity or secret, Wallet request,
signature, transaction, installation, enrollment or activation was involved.
activationApproved=false; activated=false; whole Social/crypto649 NOT_COMPLETE.
Trusted native context, revocation/checkpoints/atomic restore, SDK provenance and
licensing, real platform/Matrix/user acceptance remain separate open gates.

## Reproduction

Set VEIL_LIBSIGNAL_JAR, VEIL_NATIVE_PORT_JAR, VEIL_QA_DEPS_DIR,
VEIL_ANDROID_JAR and VEIL_JAVA_HOME to the admitted original local artifacts,
then run sh apps/social/scripts/veil-libsignal-qa/cold-ratchet-check.sh.
The runner fails if pinned libsignal bytes differ, compiles current Java sources,
retains a fresh private stage and source hashes, and runs the actual pipeline.
It does not fetch dependencies, fabricate a platform admission, or enable a module.
