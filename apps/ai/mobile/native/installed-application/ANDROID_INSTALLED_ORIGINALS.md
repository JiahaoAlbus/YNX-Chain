# P08 Android installed application loan and normal host

`InstalledApplicationOriginal.android.cpp` defines only the sole SDK's private
`InstalledApplicationOriginal` class. The original SDK defines application6;
the original common Native module defines its registrar and runtime inventory.
No new permission provider, JS install method, key read or second image is added.

`MainApplication.onCreate` binds its actual Application instance, invokes the
existing RN `loadReactNative`, then registers the matched original module before
constructing `ExpoReactHostFactory`'s normal host. RN 0.86's original loader loads
`appmodules` through its existing SoLoader path. P08 adds no library loader.
Original A supplies its ONE selected combined target and selects
`-Pynx.ai.matchedNativeV6=true` only for that matching build. The existing cohort
defaults to false and continues to report the V6 installer unavailable. Selecting
this build flag is neither a Native brand check nor Root/Source admission.

The private App-class bind has no Context/path/hash/Root arguments. The sole SDK
zero-input acquire obtains loaded paths with `dladdr` on its application6 export
and the original common Native registrar. Both must resolve in the same image.
The Java producer independently obtains the actual installed package/UID, base
and split APKs, PackageManager signing certificates, version/update incarnation,
assets and native-library directory. It retains each partial before inspection.
Android 28+ is required for this producer's actual signing metadata.

Original A embeds this asset in the actual APK before package signing:

```json
{"version":"6","applicationId":"com.ynxweb4.ai","implementingImage":{"libraryName":"<actual loaded lib basename>.so"},"privateModule":{"libraryName":"<same actual loaded lib basename>.so"}}
```

The actual basename must match `lib[A-Za-z0-9_-]+\.so`; placeholders are never
accepted. The manifest contains no supplied identity or image hash. Extracted
libraries are held beneath the actual installed native-library directory. Packed
libraries must resolve to an installed APK plus `!/lib/<actual supported ABI>/`
and the manifest's exact basename. A retained ZipFile reads the entry through
`/proc/self/fd/<held-original-APK-fd>`, not a reopened caller path. Both ZipFile
and APK descriptor stay owned until acknowledged close.

Actual file bytes use SHA256. `manifestDigest` hashes exact asset bytes; image
digests hash actual loaded file/packed member bytes. Installed identity v1 hashes:

1. ASCII `YNX_AI_ANDROID_INSTALLED_IDENTITY_V1` without NUL.
2. Each subsequent UTF-8 field prefixed with its unsigned 64-bit big-endian byte
   length: `android`, actual package ID, actual UID as decimal, installed version
   code as decimal, last-update time as decimal, signer count as decimal, sorted
   SHA256 hex digests of exact signer certificate bytes, APK count as decimal,
   full base/split APK SHA256 hex digests in sorted source-path order, exact
   manifest SHA256, implementing-image SHA256, private-module SHA256.
3. Return the complete preimage's SHA256 in lowercase hex.

These are DATA. Auth independently compares the actual captured tuple with its
Source18 identity/image pins. PackageManager metadata is not a substitute for
that qualification or an independent user approval.

Current rechecks the original OS actor, same Application, installed package
incarnation, actual manifest bytes, path/FD identity/ownership/mode/timestamps,
full APK/library hashes and loaded symbol paths. Retirement only reduces lifetime.
Java's private inventory retains partial/uncertain owners; IDs never enter JS.
ZipFile and descriptor closes are selected once. An uncertain close stays debt
and can never become success by retrying an FD or discarding the Java owner.

`NativeAIHostLifecycle` listens to the actual RN host's before-destroy event:
retire synchronously, retain the host, drain on the dedicated native teardown
executor, release that retained host only after actual true. Pending/false/error
keeps the owner. Native's matching runtime inventory additionally prevents a new
JS runtime from taking over retained old resources. Original registration failure
is sticky and registration is not blindly repeated. JNI class/method names are
kept explicitly by the App's ProGuard rules.

iOS normal startup now calls the same original registration before its Expo
factory under `YNX_AI_MATCHED_NATIVE_V6`. A must set the corresponding Swift
condition AND bridging-header macro for its selected image. Explicit native host
retirement/termination retains the factory and drains off main/JS; only true
physical close permits dropping the factory. OS termination can preempt cleanup
and is never recorded as an acknowledgement. Bridgeless developer reload is not
qualified by these startup/explicit-teardown changes.

The CI verifier compiles actual Android SDK Kotlin and NDK arm64/x86_64 objects,
checks host source against actual RN 0.86 classes, then runs PUBLIC OS/Native
doubles on real temporary files. Its JVM-only FileDescriptor reflection belongs
solely to the PUBLIC model; production uses Android's public descriptor API.
Packed-entry runtime controls need Linux `/proc/self/fd` and are explicitly
unexecuted on macOS. No check here builds/installs/adopts a whole mobile image,
reads a user key, signs, approves, sends an order, or proves business completion.
