# Normal SDK AI V6 request digest DATA bridge

Go import: `github.com/JiahaoAlbus/YNX-Chain/packages/wallet-auth/go/taskactionv6`.
The normal source is this existing SDK package's `go/taskactionv6` directory. It is not another SDK, signer, Root, Source, task worker, HTTP endpoint or JSON grant parser. Standard library only; no Root go.mod/sum is modified.

The original Node CLI adds exactly one operation:

```
{operation:"task-action-v6-request-digest-projection", networkId, proofHeader, bodyOriginal}
```

Stdin is canonical JSON with exactly four keys. Control strings are ASCII; bodyOriginal is canonical unpadded base64url of the actual original body, never a Go reserialization. The CLI decodes its existing V6 header and unsigned35, applies existing actual body/route checks, and hashes `encodeProductSessionTaskActionV6Message(unsigned, networkId)`. This is SHA256 of signed-message E5 bytes, not member/header SHA, body SHA, SHA3 or SHA512. It returns exactly eight fields: version6, requestDigest, bodyDigest, bodyBytes and DATA-only/false signature/Source/Native flags. No pubpair is supplied and this operation does not check a proof signature, certificate purpose or registration/current provenance. Actual normal Auth math and current/once checks remain independently necessary. Old CLI request/response operations are byte-equivalent after removal of the new branch/import; V6 wire35/16 and response states are not changed.

Startup/build owner API:

```
bridge, err := taskactionv6.OpenInstalledCLI(taskactionv6.BuildInputs{
    NodePath: actualPinnedNodePath, NodeBytes: actualNodeBytes,
    NodeSHA256: actualNodeSHA256, PackageRoot: actualNormalSDKPackageRoot,
    CLI_SHA256: actualCLI_SHA256,
    RuntimeFiles: wholeActualProjectionCLIGraphFilePins,
})
projection, err := bridge.Project(ctx, taskactionv6.Request{
    NetworkID: independentlySelectedNetwork, ProofHeader: originalProofHeader,
    BodyOriginal: originalBodyBytes,
})
```

BuildInputs MUST originate from the original normal protected build/startup dependency selection, never from HTTP fields or a self-claimed manifest. Supply the complete graph from the sole SDK `generateAuthRuntimeClosure(packageRoot,{entries:['scripts/inspect-task-action-v6.mjs']})` actual packed graph, not the old original Source CLI graph. Node binary pin is independent. This bridge checks all supplied rows, not JavaScript dependency graph completeness or trusted provenance. Pins are build DATA; they are not Root/image/OS qualification. Installer/original owner must protect immutable paths across execution. The bridge does not claim to defeat arbitrary hostile OS path replacement or supply load-before Root admission.

CLI path is fixed inside PackageRoot; no command, arguments, environment, provider or endpoint is accepted by Request. No shell is used. The subprocess has an empty environment, cancellation/deadline, fixed10s ceiling, stdin2MiB/stdout2048/stderr4096 caps, and original body1MiB/header196608 bounds. Input body is privately copied before process effects. Output rejects unknown/duplicate keys, noncanonical encoding, trailing documents, invalid types, counts and any signature/Source/Native claim. Go independently recomputes body SHA256/length against the captured body and rechecks pins after the subprocess. Errors expose only fixed code/safe CLI error code, no original body/stdout/stderr dump. UNKNOWN/COMMITTED/ACCEPTED/operation replay are not handled or conferred by this request-only module.

Linux and Darwin have actual no-follow/nonblocking pinned-file code. Local actual Node/Go execution is Darwin; Linux compilation is checked, actual Linux execution belongs to the normal hosted CI. Other GOOS deliberately fail closed with TASK_V6_BUILD_OPEN_UNAVAILABLE; Windows is not claimed usable. No Hermes/mobile bridge is supplied. The model does not use caller-selected GOOS to grant a release platform.

New source regression entry: `node scripts/ci/ai-task-v6-go-data-bridge.mjs` at repository root, with normal Go tool available. It constructs a real PUBLIC signed proposal fixture with raw float/Unicode and u64 above2^53/maxu64, captures a NEW actual projection CLI wholegraph and the actual installed Node pin, then runs only new Node2 and Go7 controls. Test configuration environment variables are fixture-only; production never reads them. Test keys are temporary and destroyed. No old math/Source/native matrices run.

Parent public npm files suggestion: include bridge.go, open_posix.go, open_other.go, go.mod and this README explicitly; fixture/tests remain source-only. Original CLI is already a shipped scripts member. Parent alone updates package.json, final shared source/CI/ref/npm and normal artifact qualification. There is no normal default Root/Source admission here.
