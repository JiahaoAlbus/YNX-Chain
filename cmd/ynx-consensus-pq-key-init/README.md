# New validator PQ epoch ceremony

`ynx-consensus-pq-key-init` is a Unix host-local command for an operator to create a genuinely new validator key epoch. The old `ynx-consensus-key-init` Ed25519/P2P ceremony remains unchanged. This command does not recover a lost signer history, import Wallet keys, submit registration, approve its own registration, or start a node.

The command uses the fixed `ynxconsensusauth` importer/custody profile: independent ML-DSA-87 and SLH-DSA-SHA2-256f, real AND possession proof, PBKDF2-HMAC-SHA256 with 600000 iterations and salt32, AES-256-GCM with nonce12/tag16, and a separate CSPRNG32 recovery credential already held by the operator. Private material exists only within the protected process before encryption; no plaintext key or credential is an output. See `internal/ynxconsensusauth/HOST_KEY_CUSTODY_R1.md` for the exact material/envelope ABI and Go memory-erasure limits.

## Operator inputs

The required inputs are the exact original Comet genesis plus its independent SHA-256 pin, a canonical public request plus its independent SHA-256 pin, an existing canonical absolute directory with mode 0700, and an inherited descriptor at least 3 containing exactly 32 raw credential bytes followed by EOF. The caller must already have retained that credential separately. Do not put it in arguments, environment variables or output redirection. A protected launcher can pass a pipe or an already-open protected descriptor; the command does not create a credential file.

The request is exactly the JSON serialization of this public type, with the displayed field order and no whitespace, duplicate fields, unknown fields or trailing newline:

```go
type epochRequest struct {
    Format           string                              `json:"format"`
    ChainID          string                              `json:"chainId"`
    ValidatorAddress []byte                              `json:"validatorAddress"`
    Epoch            uint64                              `json:"epoch"`
    ActivationHeight int64                               `json:"activationHeight"`
    Registration     ynxconsensusauth.RegistrationIntent `json:"registration"`
}
```

`format` is `YNX-CONSENSUS-PQ-NEW-EPOCH/v1`. Byte slices use standard padded base64 JSON. Integer text is exact Go uint64/int64 decimal; a preparer must not round it through a JavaScript Number. `activationHeight` is the global consensus activation height from the independently configured schedule; `Registration.EffectiveAt` is the key's separate effective height.

The nested object uses the existing `RegistrationIntent` field names/order, not a new signing wire. Its `MLDSA87PublicKey` and `SLHDSASHA2256fPublicKey` must be empty; only this command supplies the fresh generated pair. The other fields are frozen by the independent request pin:

| Field | First registration | Rotation |
| --- | --- | --- |
| `Kind` | 1 | 2 |
| `GenesisID` | SHA-256 of exact pinned original genesis | same original genesis |
| `ChainID`, `ValidatorAddress` | original chain and SHA256(original Ed public key)[:20] | same stable original identity |
| `Sequence` | 1 | exact next registry event sequence |
| `AuthorizingEpoch` | 0 | currently authorized old epoch |
| `Epoch` | 1 | AuthorizingEpoch + 1 |
| `ApprovedAt`, `EffectiveAt` | exact planned approval height H, key activation at least H+2 | exact planned H, activation at least H+2 |
| `PreviousEventHash` | 32 zero bytes | complete nonzero prior event hash |
| `LegacyEd25519PublicKey` | full original Ed key from pinned genesis | empty |
| `AuthorityMLDSA87PublicKey`, `AuthoritySLHDSASHA2256fPublicKey` | empty | complete current-authority pair |
| `MLDSA87PublicKey`, `SLHDSASHA2256fPublicKey` | empty | empty |

The command checks the exact genesis hash, chain, original Ed key/address/power, unique original membership, all intent syntax and H+2, and complete agreement between outer and nested identity before generating keys. These checks pin original identity and operator intent; a supplied rotation authority or request file is not committed registry authorization. The old Ed authority or current PQ authority must separately approve the resulting full intent, and the actual registry must validate and commit the full operation. The new pair cannot authorize its own admission.

## Invocation and output

After the protected launcher has opened the already-retained raw32 credential as FD 3, the normal command is:

```sh
ynx-consensus-pq-key-init \
  --new-epoch \
  --request /absolute/operator-approved-request.json \
  --request-sha256 INDEPENDENT_REQUEST_SHA256 \
  --genesis /absolute/original-genesis.json \
  --genesis-sha256 INDEPENDENT_GENESIS_SHA256 \
  --out-dir /absolute/private/new-epoch-directory \
  --recovery-fd 3
```

The pins must be independently approved values. Reading an untrusted file and automatically accepting its own hash is not pinning. `--new-epoch` is required; there is no default create mode. The output directory must already exist as 0700 and must not alias another path through symlinks. No command creates or replaces the old FilePV or node key.

The fixed output names are:

1. `new-epoch-intent.json`: permanent public exclusion marker, created and fsynced before key generation.
2. `validator-binding.json`: complete public `HostKeyBinding`, including genesis/chain/address/epoch/full pair/global activation and the exact absolute original HRS path.
3. `validator.encrypted`: authenticated encrypted private material under that complete binding.
4. `original-sign-state.json.lock`: exclusively reserved original signer lock file.
5. `original-sign-state.json`: original v2 H0 signer state created by the existing `CreateSigner` for this new epoch only.
6. `new-epoch-public.json`: full public pair/binding, exact registration intent wire, both genuine possession signatures, original paths and SHA-256 of the preceding files.

All creates use O_EXCL and mode 0600; each write fsyncs its file and parent directory. Before starting, existence of any target, including the marker or lock file and dangling symlinks, refuses the operation. Concurrent invocations contend on the same exclusive marker; only its creator can reach generation. Public binding is persisted before the encrypted vault, so an otherwise intact vault is not left without its original full public expectation when a later step fails.

The empty `NewKeyHistory` used for H0 initialization has only the independent genesis/chain anchor and zero registrations. It cannot authorize a proposal, vote or extension. Normal `ynx-comet` startup subsequently uses `ResumeHostSigner` with committed registry state and never invokes this command or `CreateSigner` as recovery.

On complete durable output the command prints only the public record. Its status is `new_epoch_files_durable_registration_not_authorized`. This confirms neither registration nor an active validator nor block finality.

## Partial results and UNKNOWN

Once the marker is present, every error preserves all original files, including partial writes. A write/sync failure after file creation is treated as UNKNOWN; no success record is printed. The command never deletes a partial target, replaces a key, resets HRS or retries generation. A repeated initialization refuses any existing target even if the prior invocation failed. If failure occurs before any recoverable encrypted key exists, the preserved marker still prevents this operation from silently becoming a different key ceremony.

Read-only reconciliation is:

```sh
ynx-consensus-pq-key-init --inspect --out-dir /absolute/private/new-epoch-directory
```

Inspection reports exact original file presence/size/hash and checks canonical public records, hash agreement and both possession signatures. It does not consume a credential, decrypt material, fsync away uncertainty, complete missing files or create HRS. `complete_original_public_hashes_and_possession_observed` is only readback of the original public receipt; it does not assert a new durability checkpoint or authority. Missing/partial/changed files return `incomplete_or_uncertain_original_result`. After legitimate signing advances HRS, its initial ceremony hash no longer matches: preserve the newer original history and use the normal runtime's recovery flow.

If the original HRS already exists after an UNKNOWN result, `ResumeHostSigner` can revalidate/reconfirm that exact original state under its original lock. If HRS is absent or invalid, recovery remains refused. This command cannot prove that a missing HRS was never previously used and therefore never reconstructs it. Preserve the original result and reconcile through the responsible operator's trusted history procedure; deleting the marker or choosing another path is not recovery. The original state directory remains trusted anti-rollback storage.

## Validation

This new command slice is source-only at freeze. No local Go command, real host key generation, service or deployment was run. Fixed CI should run:

```sh
go test -p1 -count=1 ./cmd/ynx-consensus-pq-key-init -run '^TestPQKeyInit'
```

Tests call the normal flag-parsed entry with inherited QA credential FDs and fresh isolated key material. They exercise first registration, fresh rotation possession, all full-key/public proof fields, refusal to sign with the empty anchor, real old Ed approval plus dual-PoP registry validation followed by original-HRS resume/sign/verify, nine write/UNKNOWN stages preserving exact originals, absent/existing/symlink targets, wrong public pins/intent/credential lengths, and read-only tampered-proof rejection. They do not start a node. Prior Host custody/PrivValidator CI PASS does not substitute for running this command's new tests.
