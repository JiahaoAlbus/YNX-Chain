# Independent Nym synthetic bootstrap

This code exists only with `YNX_PRIVACY_ACCEPTANCE`. Ordinary `NymModeRouteFactory.make`, the production helper dispatch, `RoutedPlatformIsolationAdmission.current` and normal target admission retain their guards. No Boolean, decoded binding, endpoint, listener, historical 9cf result or diagnostic snapshot grants authority.

The Native host calls:

```swift
let provider = try NymModeRouteFactory.makeSynthetic(
    runID: runID, explicitUserAction: action,
    epochFactory: { purpose in
        let (owner, authority) = try await BrowserRouteProtection.prepareAcceptance(
            mode: .nym, runID: runID, inputs: inputs, onLeaseLost: onLoss)
        return try NymSyntheticEpoch(protection: owner, authority: authority,
                                     manifestURL: inputs.manifestURL)
    })
let endpoint = try await provider.start()
// Read provider.syntheticEpoch only after start has returned. Its runtime owner/authority
// are the same objects used for the actual backend; do not create another Bridge or Root.
```

Each `NymSyntheticEpochPurpose` (`directory`, `initializeProfile`, `listGateways`, `addGateway`, `switchGateway`, `runtime`) obtains a fresh Root epoch and both real C self/WebKit source-app canaries. The previous auxiliary child must be actually reaped and `RootClosureObserver.awaitClosed` must observe both remote controls closed before another factory invocation. Repeated epoch UUIDs, changed run/manifest/bootstrap/logical profile/root token/executable, missing final qualification, unknown cleanup and revocation refuse continuation. The factory cannot supply an already connected/ready Boolean. Expected closure retires the local loss observer before revoking its old authority; unexpected active-epoch loss fences the original provider.

Synthetic receipts live only in `Library/Application Support/YNX Browser Routes/NymSynthetic/<runID>`. The actual vendor profile ID is the first 128 bits of SHA-256 over `YNX_NYM_SYNTHETIC_PROFILE_V1|<runID>`, formatted as the existing `ynx-route-bundled-UUID` ID. This deterministically associates the C logical `synthetic-<runID>` identity with a dedicated vendor profile; it does not derive keys. Official init creates random keys once. Existing plan conflicts/corrupt records and UNKNOWN effects remain intact, refuse replay, and never adopt normal/B1 profiles. Completed init receipts continue through the existing official directory, list/add/switch and run implementation. The fixed runtime/DNS/TLS/Mixnet/anonymous-reply code and supply stay unchanged.

After the actual selected-gateway marker and helper-verified output-discard ACK, the provider obtains the final listener graph ACK. Before resuming the independently signed proof helper it calls `SyntheticProofParentRegistration.register(authority:manifestURL:helperAuditTokenSHA256:readyBackend:)` with the original vendor gate and the proof gate's real full-token hash. The registration remains retained until cleanup. C verifies the real vendor readiness ACK and signed Provider graph; a caller's JSON receipt is insufficient.

The distinct immutable proof bundle handles `--ynx-nym-synthetic-proof-v1 <base64-binding>` before the ordinary helper dispatch. It checks actual Team/signature/role first. Binding bytes are informational constraints, not a capability. `SyntheticProofChildAuthority.begin(binding:)` must authenticate the real XPC peer and own full token against the registered nym-helper graph. Its opaque scope supplies the exact proof URL/hash/SOCKS port. The helper performs one normal-TLS, bounded GET using the existing SOCKSv5 `allowFailover=false` transfer, with fresh signed-provider authorization immediately before resume. Redirects, cookies, credentials, non-server-trust authentication and oversized bodies remain refused. Revocation cancels the active URLSession. The idle helper retains its registered process token and continues live-lease checks; EOF, bytes or revoked authority never trigger a retry.

The proof child needs its own sealed `YNXReviewedTeamIdentifier` and final `YNXAcceptanceProviderSHA256`; the parent's Info alone is insufficient. Its final signed executable hash is then pinned by the Nym parent. Ad-hoc or missing identity does not qualify.

Run only the new offline glue checks with:

```sh
YNX_NYM_TEST_OUTPUT=/dedicated/output bash apps/browser/privacy-routing/nym/tests/test-synthetic-nym.sh
```

The script snapshots real Core/Native inputs, compiles ordinary and acceptance paths using an explicit Xcode SDK/macOS14 target, uses one compiler job and dedicated caches/temp, then runs the new glue probe. It does not run the old 39/9/6 groups or vendor/network/GUI. The local initial snapshot compiled both paths and passed 43 new checks. Actual signed XPC/NE canary, auxiliary operations, keys/init, controlled HTTPS proof and the full synthetic browser fault sequence remain **NOT_RUN** on the current NoTeam host. Offline input/model negatives do not prove those positive flows.

The current Xcode Swift driver traps during startup when its process `TMPDIR` contains non-ASCII bytes (even `--version`, before source compilation). The script creates an exclusively owned ASCII `/tmp` alias pointing at the dedicated output temp directory; only the alias/empty parent directory are on the system disk, physical compiler temporary files remain under the dedicated output. The process environment is local, global `TMPDIR` is unchanged, and the alias is removed by the script trap after the compiler exits. The original SIGTRAP evidence remains separate from source diagnostics.
