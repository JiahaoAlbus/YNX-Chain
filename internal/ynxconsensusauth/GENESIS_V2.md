# Genesis-bound consensus candidate v2

This change repairs the ordinary consensus-message and cold signer-state replay exposed by remote Run12 `39086730691`, source `e9081b3a6a45217571a10935960c4ffc9e85d197`. It is source-only until the next remote CI executes it. It does not activate Comet, change the authoritative producer, integrate a remote signer, or change YNX-BATCH/v0.1.

The original regression is preserved byte-for-byte at `testdata/genesis_boundary_r1_red.go.txt`, SHA-256 `b242b74491e1298df4f7559858a11a8d52957a8b9e19a7244c53acf6d2d3e10f`. Its companion JSON records the actual RED run and original log hash. The executable test migrates only its necessary setup to explicit v2 genesis arguments; both original rejection assertions and same-genesis, cold exact signature, and H/R/S conflict controls remain. A legal verifier B is constructed from policy B and registry B. It rejects both the original A request/signature and an independently constructed B request with A's signature.

## Frozen full-message format

All fixed integers below are unsigned big-endian. `field(x) = u32(len(x)) || x`. These are candidate consensus bytes, separate from the transaction batch codec.

```
"YNX-CONSENSUS-MESSAGE/v0.2\x00"
|| u32(2) || u32(kind) || u64(keyEpoch)
|| field(genesisID[32]) || field(UTF8(chainID))
|| field(logicalValidatorAddress[20])
|| u64(height) || u32(round) || field(completeCanonicalBody)
```

Genesis is exactly 32 bytes and nonzero. Chain ID is 1–50 UTF-8 bytes. Epoch and height are positive; height remains within Comet's positive int64 range, round within its nonnegative int32 range. Kind is Proposal=1, Prevote=2, Precommit=3, Extension=4. Canonical bodies retain the pinned Comet v0.38.23 delimited canonical Proposal/Vote representation. An extension body is `field(complete ordinary canonical vote) || field(complete canonical extension)`; even an empty enabled nonnil-precommit extension receives its own signature. Maximum canonical body remains `(1<<20)+4096` bytes. Both pure FIPS algorithms receive the identical entire message with empty context; no payload hash substitutes for it.

The envelope is exactly 54,534 bytes:

```
"YNX-CONSENSUS-SIG/v0.2\x00" || u32(2) || u64(keyEpoch)
|| u32(1) || field(ML-DSA-87 signature[4627])
|| u32(2) || field(SLH-DSA-SHA2-256f signature[49856])
```

Both signatures are required. No keys, peer-selected genesis, or policy are accepted from the envelope. V1 envelopes are rejected. KeyRecord.Version and the registration/registry formats remain v1, with complete old-authority approval and dual new-key possession rules unchanged. `ConsensusGenesisVersion=2` is the independent Request/Envelope/Policy signing profile.

## Trusted boundaries and API

`NewProposalRequestV2(genesisID, chainID, trustedProposer, proposal)`, `NewVoteRequestV2(genesisID, chainID, vote)` and `NewVoteExtensionRequestV2(...)` require explicit genesis. The old constructors remain as deprecated fail-closed errors; they cannot infer an anchor from chain ID. Request fields are private and input bytes are cloned.

`Policy{Version: ConsensusGenesisVersion, GenesisID, ChainID, ActivationHeight}` must originate from authenticated consensus state. `Registry.Anchor()` must be immutable over the source lifetime. Policy, Request and registry must agree on the complete genesis and chain before cryptographic work or a signer write. The immutable `KeyHistory.Anchor()` supplies this contract, but a candidate history is not thereby committed: the state owner must independently commit/authenticate the registry root. The verifier clones the policy and rechecks source anchors at every verification; the signer does so before any retry, UNKNOWN reconfirmation, or fresh reservation.

ObjectSigningState and EvidenceState contain GenesisID; their trusted source methods receive a cloned genesis argument and their returned views must match it. Sources must produce detached immutable snapshots under their own locks. ObjectSigner snapshots local genesis under the existing Signer mutex without holding that lock across Sign, and shares the existing H/R/S history. Complete base/extension success still precedes any caller-object mutation. Commit verification constructs v2 requests using the verifier's trusted genesis and validates every present signature. Its validator set, expected block and height must originate from the same trusted genesis snapshot; raw Comet ValidatorSet does not intrinsically carry a network identity.

## Durable state and old history

New state version is `YNX-CONSENSUS-SIGNER/v2`. Its Policy includes the complete genesis. Resume validates state version, policy, trusted registry anchor, reserved full-message genesis/coordinates, real stored dual signatures and ordinary/extension companion binding **before** the existing reconfirmation write. A v1 file, missing genesis, wrong registry genesis, or policy/message disagreement causes rejection without changing the state bytes. There is no migration/reset/rename-to-backup path. Create retains exclusive-create semantics and cannot overwrite a rejected old file. Operators must preserve old candidate history; this code supplies no automatic transition permitting the same key to forget its H/R/S fence.

The existing reservation-before-crypto and signed-result-before-emission sequence remains. UNKNOWN retains its original message/signature fence. A foreign anchor cannot reconfirm or rewrite it. Same-genesis cold recovery checks and reconfirms the original file, returns its original completed signature, and rejects conflicting bytes at the same H/R/S. No second signing history or raw signing callback is exported.

For a request below the authenticated activation height, verification still uses the original upstream canonical bytes and historical signature-size/profile rules. Those old bytes do **not** contain genesis. HistoricalVerifier now supplies an authenticated immutable Anchor and receives genesis explicitly; its implementation must bind historical validator keys, block identity and height to a trusted genesis checkpoint. This interface prevents accidental source mixing but does not manufacture cryptographic cross-genesis separation for old signatures. Retained historical evidence and commits keep their historical rules; no classic fallback exists at or above activation. The durable candidate signer only signs active v2 requests.

## Fixed fork contract still required

A future engine fork must carry this same v2 profile and independently authenticated genesis/registry/activation policy through Proposal, Vote, VoteExtension, Commit, evidence, validator public-key encoding and remote signer messages. The logical address/key binding remains the full genesis-bound registry identity, never a synthetic Ed25519 key. Header validator hashes, validator updates, light-client verification, block/state sync and remote transport need coordinated versioned handling. Stock 64-byte signatures, 10-KiB remote signer limits and stock protobuf key types remain unchanged here. Increasing limits or having this package pass tests does not satisfy those engine gates. No engine activation is safe while any path still uses unbound v1 candidate bytes or peer-supplied registry state.

## Validation boundary

No local Go compile, test, benchmark or C build was run for this patch. Formatting, source-call checks, diff checks and SHA manifests are static evidence only. The next authorized remote normal CI must execute the full package, including:

```
go test -p 1 -count=1 -timeout=90s ./internal/ynxconsensusauth
```

The original regression, existing actual-crypto signer/object/commit/evidence tests, and five new v2 tests cover all message kinds, both legal genesis configurations with identical keys, exact cold replay, H/R/S conflicts, legacy/unbound file preservation, mutable caller/source rejection, and reservation/signature-stage UNKNOWN recovery. An accepting provider spy is used only in the explicitly marked non-cryptographic input-alias routing check; all signature replay, persistence, commit and evidence controls use real dual-PQ signatures.
