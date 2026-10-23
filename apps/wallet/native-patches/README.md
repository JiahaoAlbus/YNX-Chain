# Reviewed Android SecureStore read preservation and write barrier

This patch applies only to the exact `expo-secure-store@57.0.3` Kotlin source and npm integrity recorded in `expo-secure-store-57.0.3.json`. It is applied by `npm install` / `npm ci` postinstall, verified by `npm run native-patch:check`, and required by the checked-in and generated Android Gradle configuration. `expo.autolinking.android.buildFromSource` forces this module to compile from Kotlin; the upstream prebuilt AAR does not contain the fix. A native rebuild is required. Existing APKs are unchanged.

Upstream 57.0.3 includes the unconditional deletion fix from [Expo PR 49151](https://github.com/expo/expo/pull/49151), but still discards the encrypted-write `commit()` result reported in [Expo issue 48988](https://github.com/expo/expo/issues/48988). The patch checks that result before legacy cleanup. All preference commits, including cleanup, null writes and deletion, use the same process-wide monitor and failure barrier. No unacknowledged `apply()` remains in the patched module.

Upstream also has distinct **read-time** deletion branches that the write barrier
alone did not remove. Existing ciphertext with a missing AES key or bad padding
must not be deleted. Missing Hybrid keys and permanently invalidated keys must
not be returned as successful `null`/empty inventory either. The reviewed patch
now throws the existing `DecryptException`, retains the original exception cause
when present, and leaves preferences and key aliases unchanged in all four paths.
Only an actually missing record returns `null`; normal current and legacy-key
reads remain unchanged. No replacement key, migration or reset is attempted.

`native-patch:test` compiles and executes the exact reviewed Kotlin read-method
bodies with explicit PUBLIC preference/crypto boundary doubles, plus the actual
write barrier. It checks retained preference bytes, no delete/create, original
causes, normal current/legacy reads and absence. This is not actual Android
Keystore/device recovery evidence. Compiler/runtime dependencies are SHA-pinned;
Java 17+ is required. A prior exact write-barrier-only source can be upgraded only
after reconstructing and hash-checking the exact upstream source. Build `--check`
never accepts that old source and never mutates it.

SharedPreferences changes its in-memory map before disk confirmation. Consequently, propagating an error alone is insufficient: a new JS adapter or repository can otherwise read and promote a failed write. After a false or throwing commit, all subsequent native reads, writes and deletes fail until a **real process restart**. The barrier is a Kotlin object with no reset API. It spans module recreation and all keychain namespaces. This intentionally prioritizes retained disk state over continuing with unverified cache state; there is no deletion, rollback, or cache-restoration guess.

Preference snapshots and commits share a short monitor. Cipher-bound OS authentication never runs under it. Reads check again after the asynchronous decrypt; writes check in the commit after encryption and before returning. Thus an OS prompt that finishes after another operation's write failure cannot release a stale result or flush the uncertain cache. Successful legacy cleanup happens only after the encrypted write has been acknowledged. Cleanup failures also stop the operation.

The existing WalletRepository can therefore retain its current failure recovery semantics: native failure prevents later `load`, protection promotion and secret use from consuming poisoned process cache. After a process restart, ordinary repository validation works on Android's reloaded disk state. This does not claim atomicity across multiple repository writes, physical power-loss guarantees, or authenticated hardware testing.

The Node patch tests cover exact-version/source/integrity drift, prebuilt fallback, tampering, partial installation, idempotence and the build gate. Actual native compilation and fault-injection evidence must be bound to the release candidate separately; pure JS storage fixtures are not device durability proof. The SBOM marks the local Android patch separately from the upstream npm component.

When upgrading SecureStore, independently review the new upstream source and deletion behavior, regenerate exact before/after hashes, and rerun native failure/concurrency tests. Do not relax the hash check or copy this patch blindly onto a new package version.
