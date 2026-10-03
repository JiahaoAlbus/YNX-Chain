# Dormant Android Veil storage component

Base source: 32f9ce56eb39ff02814f09c0a2f3da13e23956b4.
Owned source: modules/native-matrix/android/src/main/java/com/ynx/social/matrix/VeilNativeStore.kt.
Actual compile: cached Kotlin compiler 2.1.20, OpenJDK 17, JVM target 17,
Android platform API 36 android.jar; exit 0. Component compile only, not an APK
build, libsignal JNI build or installed runtime test. Source, compiled component
and Android API jar SHA-256 values are recorded in compile-sha256.txt.

The component is internal/native-only. No Expo methods expose it, no Matrix
caller instantiates it, and existing private-message senders remain unchanged.
No product dependency, lockfile, shared interface or release configuration was
changed. It implements storage wrapping, not a protocol, ratchet or wire cipher.

Implemented code paths, NOT device-verified claims:

- Separate Social alias namespace; requires an already enrolled Android Keystore
  AES-256 key with user authentication required. No key generation, fallback,
  SSO-derived keys, funds keys or export API.
- Mature platform AES/GCM/NoPadding record wrapping with provider-generated IV.
  AAD binds storage version, owner, record kind and record ID.
- Owner-specific SQLite under noBackupFilesDir, synchronous FULL, single-thread
  transaction callbacks, stale transaction handles rejected after completion.
- Ratchet/prekey record and outbox operations share the native transaction;
  duplicate committed outbox IDs are rejected instead of re-encrypted.
- Native authority callback before operations and before successful commit.
  Callback checks alone DO NOT establish linearizable revocation against commit.

Remaining integration and security gates:

1. Official libsignal JNI stores/provider, admitted dependency/license and the
   exact required Android toolchain. This component does not provide those.
2. Native enrollment, independent device identity, migration, and authorization
   owner contract. A current-lease check callback must not be mistaken for an
   atomic authorization-effect lease; revocation/commit ordering needs closure.
3. Real device tests for locked/revoked/invalidated Keystore keys, authentication
   expiry, wrong-owner/AAD tampering, process death and backup exclusion.
4. Independent malformed-storage/bounded-allocation tests, including oversized
   SQLite blobs before cursor materialization, plus database snapshot rollback.
5. Persisted counter rollback protection, concurrency, multi-node/last-resort
   prekeys, real SPQR contribution, group/migration/backup/attachment integration.
6. Independent security review, activation approval, real product UI/journeys and
   dot/MONSTER ordinary-user acceptance. No such gate is passed by this compile.

Prior Node SQLite SIGKILL tests are separate evidence and do not verify Android
Keystore, this component or the existing mobile application at runtime.
