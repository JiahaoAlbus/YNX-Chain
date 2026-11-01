# Ordinary runtime intake and local diagnostics

## Owned synchronization consumer (2026-11-02)

`Manager.RefreshSynchronization(ctx, peer)` is the owning read-only entry;
`Status.Diagnostics.Synchronization` returns its bounded, short-lived observation
without network I/O or journal changes. The normal production constructor has
no configured ordinary sync transport and returns `NOT_SUPPLIED`. No URL,
executable, arguments, PID, transport provider or new launch flags are accepted
from a request, and this consumer does not change `ProductionSupported`.

The current original CORE source locator is
`/Volumes/西部数据/YNX-large-work/protocol/pq-storage-f8-20261031` at
`f27e07df6dd96114135aceace20a9413bba94649`. Its actual callees are:

* `third_party/cometbft/rpc/core/status.go:Environment.Status` reads the original
  `BlockStore.Height()` and `ConsensusReactor.WaitSync()`; the original result
  has `latest_block_height` and `catching_up`, **no target height**.
* `third_party/cometbft/rpc/jsonrpc/server/http_server.go:Listen` supports the
  original `unix://` transport. This is not an ordinary-node launch descriptor.
* `internal/consensus/pq_identity_query.go:queryPQIdentity` serves the existing
  ABCI path `/pq-wallet/identity`. Network consumes its exact canonical
  `PQWalletIdentityView` using `ValidatePQWalletIdentityView`; it checks native
  chain ID, native genesis, Comet chain ID and exact Comet genesis digest against
  independent host pins. That original view **does not report networkId32**.

Only `Config{IsolatedFixture:true, FixtureSynchronizationNetwork:&pins}` may
currently assemble the fixed `data/comet-sync.sock` test transport. The pins are
copied, never obtained from RPC, and the public intake tuple must match if one
is configured. This setting is rejected in production before creating a data
directory. It is a Network controlled transport fixture, not a newly supplied
CORE ABI, a qualified ordinary executable or an unsigned production fallback.

Each actual Unix connection requires current-UID/private socket provenance and
kernel peer PID equal to the actual held `exec.Cmd.Process` handle. Same UID and
a caller-supplied/stored PID are insufficient. The manager checks the same child,
run ID, generation, stage, root/data/capture and socket identity before and after
each dial and before publishing a result. Stop, Close, monitor failure and Wait
cancel outstanding reads; Wait seals reads before acquiring the manager mutex.
One attempt per run is allowed, with a two-second bound, fixed GETs only, no
redirects/proxies, bounded headers/body, duplicate/deep JSON rejection, canonical
decimal height and the original identity validator. Cancellation or failure
clears the preceding sample. A three-second monotonic deadline expires cached
results, and stop/restart/reopen never restore an old sample. Unknown socket
replacements or crash residue are preserved, never deleted/adopted.

The JSON retains `code,localHeight,targetHeight,catchingUp` and adds nullable
`source,updatedAt,expiresAt,runId,generation,networkIdentity`. Valid isolated
observations use `code:ISOLATED_PROCESS_REPORTED`,
`source:owned-process-unix-comet`, `isolatedFixture:true`, `authority:false` and
`networkId32Observed:false`. `networkIdentity` contains only the four actually
reported identity fields. Heights remain canonical decimal **strings** including
values beyond JavaScript's safe integer range. `targetHeight` remains null;
neither a target, network domain, synchronized flag, ordinary-node role nor
consensus finality is inferred from logs, wall time, browser pairing, public RPC
or `catching_up:false`. Noncurrent reports (`NOT_SUPPLIED`, `NOT_RUNNING`,
`UNAVAILABLE`, `EXPIRED`) clear every observation field rather than displaying
stale values as current.

For normal CORE consumption, the missing original owner contract must bind the
qualified ordinary runtime/launch to its fixed private endpoint, identify whether
the peer is the held foreground process or an independently qualified child,
provide independently configured chain/genesis/network-domain identity and the
real target/checkpoint semantics if one exists, and preserve parent-loss/stop
lifetime. The raw networkId32 observation remains missing; it cannot be derived
from native genesis merely because a deployment currently uses equal bytes.
Once supplied, integrate that original fixed transport here without enabling
the fixture flag in the production service or exposing a generic provider/URL.

Source binding: Network candidate `7ba74a97ea00969a16f6103c7deda3d494b23d6c`.
This is the Network consumer's missing-callee record, not a newly issued release
format, trust root, registration, launch permission or request to another owner.
Original REL/A and CORE retain their existing ownership; no peer was dispatched.

The supplied CORE `originalRuntimeB6AllFourStagedActual` public handoff was
read back at
`/Volumes/西部数据/YNX-large-work/protocol/public-runtime-b6-official-pr6gc6o9/FOUR-HOST-ACTUAL-STAGED.json`:
3367 bytes, SHA256
`b8bc50d58c5dfd3b39148110802d91403076bf4e6dcb54d1b5045f30ee8cffa0`,
source `b6b8cac02f0bb93aadcaf4855a1674ebceee4e8a`. It records a matching public
runtime staged on the four original hosts, `installed:false` and no node start;
it does not supply an ordinary-observer role, current Network publisher grant
or launch descriptor. No referenced key, signer, server or archive was opened or
changed by this consumer readback. CORE's current formal-operator-material
locator also retains
`LOCATOR_COMPLETE_FORMAL_ORIGINAL_APPROVAL_AND_INDEPENDENT_HANDOVER_MATERIALS_NOT_SUPPLIED`.
That status is narrower than “no runtime artifact exists”.

## Existing production callees and their actual limits

* `cmd/ynx-chaind/main.go:main` declares `--block-production` with a default of
  `true`; `loadNodeStartupInputs` falls back to the original validator set and
  `validateNodeStartupConfig`/`validateReplicationStartupConfig` implement the
  original validator/replication topology. This is not an admitted ordinary-node
  executable merely because a caller supplies another flag or public RPC URL.
* `cmd/ynx-comet/main.go:main` registers the original Comet `start` and switches
  to `runPQNode` when PQ options are present. `constructPQNode` reads the existing
  validator key/state and `consensus.NewPQConsensusNode` accepts an original
  `PrivValidator` and PQ signer. The remote path calls
  `consensus.NewPQRemoteConsensusNodeSession` with an original signer connection,
  peer pin and host-key binding. The supplied code has no qualified Network
  ordinary-observer launch descriptor. The legacy default node constructor is
  not an authorization to generate/reset keys or start a signer from this App.
* `internal/ynxbatch/artifact_publication.go` supplies
  `ParseArtifactPublicationManifest`, `InspectArtifactPublicationMessage` and
  `InspectArtifactPublicationMember`. They inspect original public DATA. Their
  fixed publication version/role are `YNX-IDE-ARTIFACT-RELEASE/v1` and
  `ide-artifact-publisher`, and are not a Network node issuer registration.
  `ynxbatch.NewVerifier(...).VerifyOne` performs original dual-signature/member
  mathematics with `ResolveTrustedOwner`; the caller must already possess an
  independently admitted current registration. The original
  `YNXRegisteredANDMemberVerifyN1RequestV1` C ABI likewise explicitly grants no
  Root/current authority. Network does not make its own trust resolver or sign
  a new publisher registration to turn these primitives into a release.

`Manager.Install` and production `Manager.Start` therefore retain
`ErrOriginalReleaseMissing`. `Status.ProductionSupported` stays false. Existing
`InstallFixture` and its real compiled Go observation binary remain isolated
lifecycle tests and cannot be selected by the normal production request.

## Minimum original-owner delivery needed for activation

The original REL/A owner is recorded in `OWNER_REGISTRY.json` as
`REL/original A`, thread `01a0f351-8f50-7632-8a7e-faba5dac6030`; CORE owns the
actual consensus runtime. Their current handoff must provide the following
original capabilities together, rather than a Network-authored schema:

1. Exact ordinary executable bytes for the target platform/architecture, its
   original canonical manifest and detached signature, and the original verifier
   entry point. Publisher identity, network domain, current revision/epoch,
   revocation and role must resolve through the independently admitted original
   owner. A downloaded hash or a certificate's embedded key cannot admit itself.
2. A qualified, fixed ordinary-node runtime entry which cannot produce blocks,
   open a signing provider, generate/reset validator keys or use the four
   validators' storage. Supply its exact allowed invocation/environment and
   public network pins (networkId32, native genesis, Comet chain ID and genesis
   where applicable), plus original bootstrap/checkpoint inputs. They must be
   independently configured, not inferred from untrusted RPC or a task payload.
   The current fixed no-argument fixture executable is not that entry.
3. The runtime's owned executable/data layout, foreground lifecycle, parent-loss
   behavior and original read-only local observation interface. The latter must
   bind to the actual owned runtime and network and return typed local height,
   target/checkpoint height and catching-up semantics. A public gateway's
   `/status` or a stdout string containing `synced=true` is insufficient.
4. The original current native/user registration and exact operation approval
   contract needed by that ordinary runtime, if distinct from the existing
   visible Network consent producer. Current-UID IPC, the browser read ticket,
   an artifact digest and a persisted PID do not supply this registration.

Network already owns `Prepare -> original visible native decision -> ApproveNative ->
Install/Start/Stop`, exact byte capture, filesystem identity, quota preflight,
owned process `Wait`, and durable UNKNOWN preservation. Once the actual original
callee/registration is supplied, integrate it here without replacing those
boundaries or exposing arbitrary commands, arguments, environment or PID control.

## Public runtime intake and direct native consumption

`OpenRuntimeCandidate(manifestPath, independentlySuppliedSHA256, executablePath)`
now captures bounded public bytes after exact pin, pre/open/post inode/mode/
size/mtime checks, canonical metadata, platform/architecture and native executable
header checks. The metadata version
`YNX-NETWORK-ORDINARY-RUNTIME-INTAKE/v1` is explicitly a Network-owned intake
wrapper, not a replacement for an original signed CORE manifest or launch ABI.
It carries release version, 40-hex source revision, canonical HTTPS source
labels, exact byte count/digest, original-manifest/runtime-contract digests,
independent network pins, and the only accepted role `ordinary-observer` with
producer/validator/signer/validator-key flags all false. False metadata flags
cannot establish that executable's role; original runtime qualification remains
necessary. JSON cannot select an executable, path, command, argv or environment.

The native header check reads only fixed-width bounded fields and walks at most
4096 bounded MachO load commands; ELF program-header extents are bounded by the
actual input length. It does not allocate tables from untrusted header sizes,
execute a version probe, validate a publisher signature or accept a shell file.

The normal host constructor is:

```go
candidate, err := ownednode.OpenRuntimeCandidate(manifestPath, independentPin, artifactPath)
// On error preserve the original files and report the precise rejection.
node, err := ownednode.New(ownednode.Config{
    Directory: privateOwnedNodeDirectory,
    RuntimeCandidate: candidate,
    ExpectedRuntimeNetwork: &independentlyConfiguredNetworkPins,
    // Explicit bounded artifact/storage/free-space limits remain applicable.
})
```

This makes the actual public candidate visible via `Status.RuntimeCandidate`,
always `authority:false`, `originalReleaseAdmitted:false`; it enables no process.
`ConfigureRuntimeCandidate` is the equivalent existing-peer startup assembly API.
It cannot replace an installed selection, change network domain to a genesis
hash, or adopt an unknown/reconciling run. HTTPS provenance is a label and is
never fetched by this API. `NetworkID32`, native/Comet genesis and Comet chain ID
remain separate independently configured fields.

`ApproveNative(ctx, peer, intent, producer)` directly calls the original
`nativeconsent.Producer.Confirm(ctx, intent, mode)` through a trusted-host-only
interface, then checks cancellation, generation and manager identity again.
The manager mutex is released during visible review. The former
`Approve(peer, intent, true, ttl)` API now accepts isolated fixtures only;
production cannot mint an approval using a host/JSON boolean. The normal service
must call `ApproveNative` instead of confirming and then calling `Approve(true)`.
The release gate rejects a currently unsupported production install/start before
opening a useless approval prompt. This original producer supplies exact local
operation consent, not publisher, Source, account or network role registration.

`RestartNative(ctx, peer, producer)` requires the currently owned running handle,
prepares/stops/waits that run with its exact native decision, then prepares a
new-generation start with a separate fresh native decision. Cancellation or
denial after Stop leaves the actual stopped result; the API never reuses the
old approval, rolls back old logs, adopts a stored PID or replays UNKNOWN.
An IPC restart entry should carry only an empty fixed payload and call this
method; no caller-supplied PID, `allow` boolean or generic route belongs to it.

The common exact-byte installer now also accepts a checked candidate through
`InstallConfiguredFixture`, explicitly in `isolated-lifecycle-fixture` mode.
Its complete original intake bytes/pin join the durable installing claim before
atomic `bin/node` publication, and `InstalledRuntimeReadback` verifies and returns
those bytes after normal reopen. Source inode replacement fails before a claim.
This exercises actual native transport, install/start/restart/stop/Wait and log
retention with compiled observation fixtures; it is not an unsigned production
fallback. The normal production `Install` preflights a configured candidate but
still requires the missing actual original release/runtime admission callee.
There is deliberately no injectable mock issuer or fake production-root factory.

When CORE supplies an actual ordinary runtime/launch/sync contract qualified for
the authorized local QA scope, its local capability must be distinguished from
formal A publication/signing. Neither a fourth-validator binary relabeled as an
observer nor turning on `IsolatedFixture` in the production host is that intake.
The original source/current/signature requirements relevant to the selected mode
must be bound to the real callee rather than inferred from these metadata labels.

## Implemented diagnostic contract

`Manager.Status(peer)` includes `diagnostics`; `Manager.ReadLogs(peer, runID)`
reads only a known journal run ID (empty selects the latest). Both are read-only
and require the existing verified current-UID peer. No management operation or
approval is created by either read.

* `diagnostics.code`: `LOCAL_OBSERVATION_ONLY` or `UNAVAILABLE`;
  `authority:false` always.
* `diagnostics.logs`: `code`, `runId`, `authority:false`, nullable `stdout` and
  `stderr`. Codes are `NOT_SUPPLIED`, `CAPTURING`, `CAPTURED`, `INCOMPLETE`,
  `UNAVAILABLE`. Each stream has `text`, `encoding:"utf-8-with-replacement"`,
  decimal-string `capturedBytes`, nullable decimal `observedBytes`/`droppedBytes`,
  nullable boolean `truncated`, boolean `wireTruncated`, `complete` and raw-file
  `sha256`. The SHA is local byte provenance, not publisher/proof authority.
* Capture stores the first at most 32 KiB per stream (smaller under quota); wire
  text is only the final 512 raw bytes of that captured prefix. Thus a verbose
  process does not silently present this as the actual latest output. `truncated`
  identifies bytes not captured; `wireTruncated` identifies captured bytes not
  included in the wire tail. Worst-case JSON control-character escaping of both
  tails remains bounded. Render `text` as text, never HTML or a sync protocol.
* Captured files are current-UID/private, identity-bound and retained per run.
  At most 64 runs are retained; a full retention/quota budget denies another
  start before any child. There is no automatic log deletion/rotation/adoption.
  Run data is finalized only after the original child and output drains finish.
  Completed reads check original inode/size/digest; unknown replacement is
  preserved and unavailable. A changed live log stops only the original child.
* A crashed owner leaves `INCOMPLETE`; total observed/dropped/truncation fields
  are null because discarded pipe bytes cannot be recovered from a file. Actual
  retained file length/digest may still be read. The manager does not upgrade
  an interrupted run to a completed log or clear its original UNKNOWN journal.
* `diagnostics.synchronization` stays `code:"NOT_SUPPLIED"` with null
  `localHeight`, `targetHeight`, `catchingUp` until the actual runtime contract
  above exists. Running time, parsed logs and public RPC cannot fill these.
* `diagnostics.recovery` has `code:IDLE|OWNED_RUNNING|RECONCILING`,
  `autoRestart:false`, `storedPIDIsControlHandle:false`, actual `processOwned`
  and `priorEffectUnknown`. Original status `firstCause`/`lastExit` remain
  unchanged. Reopening never adopts or signals the stored PID or auto-starts.

These are cooperative local process/storage observations, not OS containment,
node sync proof, Wallet approval, consensus finality, funds or a production grant.
The crash test's Go fixture observes its own parent loss and exits solely to
avoid a test orphan; that is not a supplied ordinary runtime guarantee.

## Existing independent transaction proof path retained

`receipt.OpenPQCommandVerifier` pins the package's original CORE verifier and an
independently selected original public context. `PQCommandVerifier.Verify`
invokes the actual `ynx-consensus-proof-verify` transaction trust-context command;
`CollectorLookupID` binds a selected Whole member to its actual original
collector lookup. Receipt input cannot choose files, clock, command or trust.
No-context reads stay `RPC_ONLY`; stored receipts stay historical with
`authority:false`. Existing original-signature/native-profile/process evidence
is reused; this diagnostics change neither rebuilds a verifier nor promotes
ABCI transaction results into account/funds-state membership.

The later original PERF handoff
`shared/PERF/normal-live-41320297313-original/HANDOFF.json` was independently
read back as 13915 bytes, SHA256
`5d02d07717afa586a254da567f21e3a7a5193463489b2d19edc610bdcb4e5423`.
It records the isolated original full-proof/confirm flow and a retained shutdown
exit defect; `independentCryptoReverifiedHere:false` and
`normalSourceAuthorityGranted:false` remain explicit. It supplies no current App
public-network context, ordinary-runtime approval, funds-state proof or TPS
qualification. Network reuses applicable original verifier semantics without
promoting that handoff into a new trust anchor or rerunning old proof suites.
