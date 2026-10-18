# Original Android Wallet PQ Native adapter

This directory owns the fixed C ABI and Native lifecycle. Main owns JNI,
Keystore and App calls; Auth owns recognized authorization and original Source.
The versioned header is the integration surface. No private material crosses RN.

The original A builder first materializes the exact Protocol source:

```sh
node prepare-provider-stage.mjs /path/to/original/protocol/source fd8b8dcf7dda9823a439db04b1e33e2375014568 /new/stage
```

After preparing the ordinary Go dependencies in that stage, the original A
builder can use the normal NDK arm64 compiler (API 28 or later):

```sh
node build-android.mjs /new/stage /ndk/toolchains/llvm/prebuilt/host/bin/aarch64-linux-android28-clang /new/output/libynx_wallet_pq.so
```

This entry preserves the stage file hashes and refuses output replacement. It
does not run Gradle, install an APK, grant authorization, or submit transactions.
The published `wallet-pq-android.h`, not the cgo-generated implementation header,
is the client header. Main must resolve the three fixed original callee symbols
in the same Native process. Missing original callees refuse operations; a valid
reference and independent original Source/current checks are still mandatory.

Callers retain every non-null partial before inspecting return codes. Retire,
join and close partials through their original worker; do not retry UNKNOWN
signing or discard uncaptured signed output. Signing borrows one OS thread for
both Auth phases. Full E and both public keys are checked; a digest is not an
authorization. Auth phase two runs on every exit after successful phase one,
including cancellation and math failure, retaining the first failure.

Native references use at most 4096 nonreused process-lifetime token cells. Close
releases the Go payload but preserves the small C tombstone to prevent stale
pointer reuse. Capacity exhaustion requires ordinary process restart after all
operations drain; it must not reset accounts, storage, or pending journals.
Go/upstream heap allocations have no immediate physical-zeroization guarantee.

Source checks and host controls are not Android NDK/JNI validation. Activation
requires Main's actual cipher-bound Keystore, Auth's genuine held capability,
matching packaged artifacts, installed-device review/sign/recovery, and the
original approval gates. None is implied by producing the shared library.

The existing SDK workflow runs only the new restoration and C ABI controls on
Linux for this Native branch. It leaves the sealed SDK331 packaging job alone.
On Darwin, Go's external linker additionally needs an explicit allowlist for
the three original weak symbols (Linux/Android do not use these Darwin flags):

```sh
CGO_LDFLAGS_ALLOW='-Wl,-U,_(ynx_original_wallet_android_transfer_assert_current|ynx_wallet_main_android_pq_store_new|ynx_wallet_main_android_pq_load_original)' GOMAXPROCS=1 go test -mod=mod -p 1 -tags ynx_bridge_test -v -run '^(TestBridge|TestNativeRestoreUsesWholeExpectedPairAndNoPlainExportAfterStorage)' ./packages/wallet-auth/native/android
```

Run this command inside a newly materialized stage. The test tag includes only
PUBLIC lifecycle/data fixtures, with no successful original Auth callee and no
real account material. Production builds do not include these fixtures.
