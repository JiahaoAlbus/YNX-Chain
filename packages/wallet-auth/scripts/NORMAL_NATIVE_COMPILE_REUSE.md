# Normal 23/24 machine-code reuse binding

## Explicit Main711/Auth26 to Main2c200b/Auth28 DATA comparison

The same CREATE/VERIFY CLI now dispatches to the explicit Main component
contract only when the request supplies `sourceExecutionHandoff` and
`targetMainProfileHandoff` pins. These bind the original A26 combined17/helper11
execution and the formal Main28 target profile. Both tuple JSON files still
need an actual composed source root, its inventory, a pinned `plansRef` exported
from that root by the normal Main/supplier plan functions, and its independently
versioned runtime root/manifest. A profile's TU list is not an exported plan.

This branch checks 81 supplier plus 12 Main C++/header inputs, Main's single
co-resident archive, 17/11 ordered TUs, original process/driver argv, headers,
both runtimes and exact selected artifacts. It preserves supplier materialization
facts and independent-evidence limitations separately. Its receipt remains
`YNX_NORMAL_NATIVE_COMPILE_REUSE_BINDING/v1`, with `compileReuseAdmitted:false`
and Native/Source/App/install qualification false. No compile, load, artifact
copy or original record rewrite occurs. Actual target source/plan and a bounded
read window are required before CREATE/VERIFY; the old 23/24 proof cannot select
this branch. The existing completed-proof lightweight reader still accepts
only its original completed 23/24 proof.

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

## Original A SDK23 actual executed schema

The same CLI and `YNX_NORMAL_NATIVE_COMPILE_REUSE_BINDING/v1` also accept original `YNX_SDK23_R196_ORIGINAL_A_EXECUTED_NATIVE_RECORD_V1` records. This explicit branch reads the original fields; it never retrofits `kind`, `helperBuild`, or a fabricated `toolchain` into the record. Unknown schemas refuse. The existing legacy branch remains supported.

For this branch each tuple keeps sourceRoot/version/inventory/plansRef/runtime.root/runtime.manifest. Do not supply a synthetic legacy toolchain. The separately pinned executionEvidence map contains originalExecutedRecord, originalFullH, finalH, mandatoryLimitation, actualChildToolArgv, and plans, all pinning actual original-builder files. The adapter verifies the original seventeen requests/terminal exits, captured driver PID/start/PPID and full argv, captured launcher-to-Xcode-driver mapping, owned-process emptiness, original source/normal/header manifests and PRE/POST, current 77 compile inputs, both independently versioned runtime unions, and arm64 artifacts. It performs reads only.

`helperExecuted:false` means no helper business activation; helper compilation is checked through NORMAL_HELPER11_BUILD and its eleven-unit captured compiler driver. Mandatory materialization limitations survive as strictCOWQualified:false and copyPhysicalFallbackUnknown:true. Captured argv does not independently pin a compiler binary or a complete OS SDK; both limitations are explicitly false in the derived toolchain DATA. Original execution remains supplier evidence rather than an independently witnessed process. NativeQualified/SourceActivated/helperRegistered/AppBuilt/installed remain false. Auth25 is not accepted or relabeled as Auth24; it needs its own successor compatibility and runtime closure binding.

Actual pinned request maps are delivery evidence outside the package. For the selected SDK23/24 delivery they reside under `.wallet-source-evidence/native-reuse-actual-schema/`; the owner must schedule the bounded read of both real runtimes before invoking the same `--output` and `--verify` CLI. PUBLIC prefix tests do not read real runtimes or create a qualified actual receipt.

## Read an already completed R3 proof without replaying verification

Use the same module's `readCompletedNormalNativeCompileReuseData({completedHandoff})` for an IDE consumer of a completed proof. `completedHandoff` is an exact `{path,bytes,sha256}` pin received through the consumer's trusted delivery channel. A hash obtained from an arbitrary untrusted handoff is not an authority anchor.

```js
import {readCompletedNormalNativeCompileReuseData} from './normal-native-compile-reuse.mjs';
const data = readCompletedNormalNativeCompileReuseData({completedHandoff: trustedHandoffPin});
// data.receipt is the existing same-schema receipt pin; data.binding is its
// deeply frozen DATA. Compare data.targetTupleData / binding.targetRuntime
// against the IDE's own normal target-package byte gate before using a package.
```

The reader only reads a capped set of small pinned evidence files: the authoritative completed H, its frozen executed adapter, the existing `YNX_NORMAL_NATIVE_COMPILE_REUSE_BINDING/v1` receipt, original A record/full/final/limitation handoffs, tuple and execution-evidence JSON, consumed plan/grant, actual CREATE/VERIFY starts/zero terminals/stdout/empty stderr, and owned-join outcome. It checks cross-file pins, recorded argv/PIDs, terminal success and owned emptiness, the original 77 input/artifact records, distinct 92/95 and 9342/9344 runtime references, and preserved limitations. It does not recursively follow handoffs, read either runtime manifest or runtime file, read actual source/headers/binaries, call create/verify, launch a process, write a receipt, or grant any permission. The existing CLI `--verify` retains its full verification behavior; this explicitly separate consumer API never silently weakens it.

Return fields `completedEvidenceRead:true` and `dataOnly:true` describe the completed evidence read. `runtimeFilesRehashed`, `actualArtifactsRehashed`, `targetPackageBytesVerified`, `NativeQualified`, `SourceActivated`, `AppBuilt`, `installed`, `realUserLogin`, `realSessionRecovery`, and `realRevocation` remain false. COW/physical-fallback, compiler/OS SDK capture, helper and R201 limitations are retained. No second receipt/schema is created, and the live module is not substituted for the immutable adapter bytes that performed the original R3 execution.
