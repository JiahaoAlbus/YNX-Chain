# P08 installed iOS application loan

`InstalledApplicationOriginal.ios.mm` implements the sole SDK's private
`InstalledApplicationOriginal` class. It does not implement application6 exports,
register a provider, accept JS identity fields, or grant approval. Compile it in
the original A selected combined image against the matching private SDK headers.
Android's producer and normal App registrar/teardown wiring remain owning CODE.
This source is not an installed or admitted App.

The zero-input acquisition obtains `NSBundle.mainBundle`, requires the actual
bundle ID `com.ynxweb4.ai`, and retains read-only FDs for the installed Info.plist,
main executable, `_CodeSignature/CodeResources`, original manifest, and the two
loaded symbol images. Unsigned/simulator bundles without the signature resource
are unavailable; a signature resource is only captured DATA, not an independent
signature verification or Source qualification.

The original builder places `YNXAIInstalledModuleManifest.v6.json` in the outer
App bundle before signing the outer application. Its exact four members are:

```json
{"version":"6","applicationId":"com.ynxweb4.ai","implementingImage":{"relativePath":"<actual A selected loaded image relative path>"},"privateModule":{"relativePath":"<same loaded image relative path>"}}
```

Paths come from the actual selected artifact. Actual image hashes are computed
from held installed files and are never taken from manifest fields. They are not defaults
and must not be guessed from these placeholders. `implementingImage` is checked
against `dladdr(ynx_ai_mobile_application_acquire_v6)`, and `privateModule` against
`dladdr(YNXOriginalAIMobileV6RegisterBeforeReactHost)`. Both must name the same
loaded file inside the actual App bundle. A manifest digest never attests itself;
Auth independently compares the actual manifest/image tuple with Source18.

`installedAppIdentityDigest` uses this private v1 preimage, in this order:

1. Exact ASCII bytes `YNX_AI_IOS_INSTALLED_IDENTITY_V1`, without NUL.
2. For each field, an unsigned 64-bit big-endian byte length followed by its
   exact UTF-8 bytes: `ios`, actual bundle ID, Info.plist SHA256, main executable
   SHA256, CodeResources SHA256, original manifest SHA256, implementing image
   SHA256, private module SHA256. Hash fields are lowercase 64-character hex.
3. SHA256 of that full preimage, returned as lowercase hex.

This derived identity is not embedded in the manifest, avoiding a self-hash.
The manifest contains no image hashes, so it supports A's actual combined main
executable or combined framework without a manifest/signature self-reference.
Original A freezes the actual signed App and its final file digests externally;
Auth then independently compares the installed capture with Source18.

Acquire returns a nonnull partial before reporting failures. Read/current run on
the acquisition actor, recheck the actual bundle, resolved original paths,
FD/path device/inode/size/owner/mode/mtime/ctime and full file hashes. Retirement
is atomic and only reduces lifetime. Close reports physical completion separately
from prior failures, never retries an uncertain close or reuses an FD. Failed
close remains debt on every subsequent close call. No member grants Root,
Source, signing authority, tool execution, or replay permission.
