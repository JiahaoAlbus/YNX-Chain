# Normal 23/24 machine-code reuse binding

This is an offline adapter for one original A executed 13-TU addon / 11-TU
helper record. It does not compile, load, copy artifacts or change that record.
It does not qualify Native, Source, installation or a user flow.

Normal entry (absolute paths; output must not exist):

```
node packages/wallet-auth/scripts/normal-native-compile-reuse.mjs --request /A-evidence/reuse-inputs.json --output /A-evidence/sdk24-compile-reuse.json
node packages/wallet-auth/scripts/normal-native-compile-reuse.mjs --request /A-evidence/reuse-inputs.json --verify /A-evidence/sdk24-compile-reuse.json
```

IDE and SDK use the SAME `YNX_NORMAL_NATIVE_COMPILE_REUSE_BINDING/v1` schema
and `verifyNormalNativeCompileReuseBinding({request,receipt})` export. Do not
create a second receipt format. `receipt` is a pin `{path,bytes,sha256}`.
The request is a reference map, not a new executed receipt:

```json
{
  "sourceTuplePath": "/A-evidence/sdk23-original-refs.json",
  "targetTuplePath": "/A-evidence/sdk24-original-refs.json",
  "executedRecord": {"path":"/A-evidence/original-executed-record.json","bytes":123,"sha256":"<original SHA256>"},
  "executionEvidence": {"path":"/A-evidence/original-builder-caps-binding.json","bytes":123,"sha256":"<readback SHA256>"}
}
```

Each tuple reference map contains:

- `version`: exact `1.3.0-pq.3.32-auth.23` or `.24`.
- `sourceRoot`: actual frozen source root. For source23 this MUST equal the
  original executed record's sourceRoot; do not use the old plan-only root.
- `inventory`: pin of that tuple's original
  `packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json`.
  The adapter reads all normal92 or normal95 files and their bytes. Independent
  Source-current IO1 is excluded from this base machine-code reuse.
- `plansRef`: pin of the original exported `{node,helper}` JSON at that actual
  source root, such as the original A exported normal plan. An embedded `plans`
  object with precisely the same original fields is also supported. Every
  tool/argv token and ordered TU list is checked. Only absolute root and `-I`
  root path prefixes are normalized; all macros, SDK/header paths and flags
  stay exact. No Main14, CABI or role flags are accepted.
- `runtime`: `{root,manifest}` where manifest pins the tuple's normal union
  `YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1`. Every file in it is read, and the
  runtime package.json must match this exact version. SDK24 cannot borrow the
  SDK23 package/union. Absence of the SDK24 authoritative union blocks binding.
- `toolchain`: identical original-builder captured `{abi,compiler,sdkInventory,
  headersInventory,abiObservation}`. Four latter entries are immutable file pins;
  ABI is `{platform:"darwin",arch:"arm64",napiVersion:8,headerVersion:"22.13.1",
  minimumSystemVersion:"13.0"}`. The original A's independently captured complete
  header/SDK inventory and ABI readback remain necessary; this adapter does not
  infer a complete toolchain or passive-load qualification from C++ identity.

The separate caps-binding JSON contains `originalExecutedRecord` (the same
exact pin) and `toolchain` (the same independent captured evidence). It links
A's original process/readback evidence to the unchanged executed record. It
must be supplied by the original builder, not synthesized as a Native authority.
No new `record.toolchain` field is required or inserted.

Actual executed-record fields consumed are the existing normal
`YNX_WALLET_ORIGINAL_NATIVE_BUILD` v1 shape: sourceRoot/sourceInventory,
architectures, commands/exitCodes, ownedUndefinedScan, output, inputFiles,
headerVersion/NAPI/minimumSystemVersion and the corresponding
`YNX_WALLET_ORIGINAL_HELPER_BUILD/v1` helperBuild. Plans or readback-only records
are refused. Both output files are hashed and their arm64 Mach-O type checked;
this does not execute them. Full source/runtime and raw record are rechecked.
The adapter cannot independently prove the compiler process ran; original A
provenance remains the authority for that historical fact.

The derived receipt always has `executed:false`, `targetRecompiled:false`,
`NativeQualified:false`, `SourceActivated:false`, `AppBuilt:false`,
`installed:false`. It preserves sourceNormalInputCount92 and target95, each
inventory/union pin, all77 compile pins, exact original executed-record pin,
independent toolchain evidence, and the selected execution's actual artifact
hashes. Absolute selected-source/debug/__FILE__ paths remain in that artifact.
It does not assert separately compiled binaries would have equal bytes.

Current mapping: original A light evidence is in
`/Volumes/西部数据/YNX-large-work/original-a-builds/sdk23-sdk24-native-base-light-intake-20261024/`.
Use the authoritative source/normal supply references from its
`AUTHORITATIVE_REFS_AND_SINGLE_COMPILE_INPUT_COMPATIBILITY.json`, not incomplete
older H files. The selected23 execution root/record/toolchain come from the
new original A run; the light plan is not an executed record. SDK24 normal
package/union is an independent pending input until supplied. No current
production reuse receipt is generated by the PUBLIC tests.
