# Validator host custody R1

This slice imports the existing public key-material ABI into the pinned CIRCL provider and adds a separate validator encrypted container. It resumes the original durable signer. It does not grant validator membership, create a recovery H/R/S file, or accept a Wallet account backup.

Status at source freeze: implemented, not locally compiled or executed. The fixed remote CI must execute the tests below. Normal CLI consumer is `cmd/ynx-comet`: explicit PQ mode loads the original FilePV/state and P2P node key, independently pinned bootstrap/schedule/public binding, then calls `ResumeHostSigner` and `NewPQConsensusNode`. The credential is exactly 32 raw bytes from an inherited FD, never an argument, environment variable or log field. These source interfaces alone do not establish deployment or BFT operation.

## Public source contract

The original SDK owner confirmed the public ABI in `PUBLIC_PROVIDER_ABI_CHAIN_INTAKE_R1.json` (SDK commit `31bb24a5a315d3ba0b3bcdddf542af0943b0c4ef`, artifact SHA-256 `b9527fd549317cd80bf0915636ff1a271fd34dce100205c827ec6059439d8fde`). Only public sources/metadata were read; no Wallet key, credential or backup was opened.

| Public source | SHA-256 |
| --- | --- |
| `@ynx/batch-v01-candidate/docs/KEY_MATERIAL_ABI.md` | `15a48046aef36045a62384404dfdd76eb07e3979ff26f48720f750406a39510c` |
| `packages/wallet-auth/integration/PQ_WALLET_BACKUP.md` | `a8c1ccf15fed8219f4a7e76257c4fc858b2cda346c993cc97ae29c9804a5f1e5` |
| `packages/wallet-auth/src/pq-wallet-backup.js` | `7e4b18b0c662d3fe666831845cb8f9bcdebce53ce631320192b15aa68f7f30ef` |

Material profile is exactly `YNX-BATCH/KEY-MATERIAL/v1`, algorithm label `YNX-BATCH/v0.1`, suite `ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512`. These existing material labels do not change the consensus v2 message domain or introduce a caller-selected prehash.

* A: 54-byte DER = `3034020100300b060960864801650304031304228020` followed by the ML-DSA-87 seed32; public key 2592 bytes.
* B: 150-byte DER = `308193020100300b0609608648016503040319048180` followed by `SK.seed32 || SK.prf32 || PK.seed32 || PK.root32`; public key 64 bytes.

Import rejects alternate headers/OIDs, expanded ML material, trailing bytes, wrong suite and sizes. It regenerates ML from its seed; it regenerates the complete SLH secret from the first 96 bytes and compares all 128 bytes, then compares both derived public keys with the independently expected pair. A fresh internal domain-separated challenge signs and verifies both real branches with empty context. No self-test signature escapes. The provider remains `github.com/cloudflare/circl@v1.6.5`, pure ML-DSA-87 and SLH-DSA-SHA2-256f, AND.

## Exported protected-process interface

```go
type CandidateKeyMaterial struct {
    Format, AlgorithmVersion, Suite string
    PKCS8A, PKCS8B, PublicA, PublicB []byte
}
func (*CandidateKeyMaterial) Clear()
func GenerateCandidateKeyMaterial() (*CandidateKey, CandidateKeyMaterial, error)
func ImportCandidateKeyMaterial(CandidateKeyMaterial, []byte, []byte) (*CandidateKey, error)

type HostKeyBinding struct {
    Policy Policy
    ValidatorAddress []byte
    Epoch uint64
    MLDSA87PublicKey, SLHDSASHA2256fPublicKey []byte
    SignerStatePath string
}
func (HostKeyBinding) Validate() error
func GenerateHostRecoveryCredential() ([]byte, error)
func SealHostKeyEnvelope(CandidateKeyMaterial, HostKeyBinding, []byte) ([]byte, error)
func OpenHostKeyEnvelope([]byte, []byte, HostKeyBinding) (*CandidateKey, error)
func ResumeHostSigner(string, []byte, HostKeyBinding, Registry) (*HostSigner, error)
func (*HostSigner) Signer() (*Signer, error)
func (*HostSigner) Close() error
```

Generation is an explicit new validator-owned key ceremony; runtime recovery never calls it. The material object is plaintext only inside the protected process: the caller clears it after sealing/import, and must not serialize plaintext to disk or expose it to an untrusted renderer. The opaque key exposes only the existing typed registration possession and durable consensus signing flows. A successfully imported key still needs independently authenticated committed registry authority.

## Exact validator envelope

`E` concatenates `U32BE(field byte length) || field` for each listed field. Integers are U32BE; a uint64 is two fields, high then low. There is no count field, and decoders require the exact field count with no trailing bytes. Domains below include a final NUL byte. Envelope maximum is 32768 bytes, checked before decoding/allocation; the HRS file remains subject to its original 2 MiB bound.

Binding is E of 13 fields:

1. `YNX-CONSENSUS-HOST-KEY-BINDING/v1\0`
2. container version 1
3. consensus policy version 2
4. genesis ID, exactly 32 bytes
5. chain ID, existing registry-anchor validation
6. original logical validator address, exactly 20 bytes
7. epoch high U32
8. epoch low U32
9. activation height high U32
10. activation height low U32
11. complete ML public key, 2592 bytes
12. complete SLH public key, 64 bytes
13. original absolute clean UTF-8 HRS path, nonempty, at most 4096 bytes, no NUL

Epoch and activation are positive. The path binds the original history location; it is not an authorization to copy old history to a new path. Existing signer locking resolves the parent path, rejects final-component symlinks and hard links, and holds the original OS advisory lock.

Envelope is E of 9 fields:

1. `YNX-CONSENSUS-HOST-KEY-ENVELOPE/v1\0`
2. version 1
3. complete binding wire above
4. `PBKDF2-HMAC-SHA256`
5. iteration count 600000
6. independent fresh salt32
7. `AES-256-GCM`
8. independent fresh nonce12
9. ciphertext followed by tag16

The fixed KDF/AEAD parameters come from the existing SDK custody profile: PBKDF2-HMAC-SHA256, 600000 iterations, derived key32, salt32, AES-256-GCM nonce12/tag16. The credential is independent CSPRNG32 decoded to raw bytes, not a human password or mnemonic. AAD is exactly E of envelope fields 1–8. This validator E container has its own domain; Wallet's ordered JSON envelope is deliberately not its wire format.

Plaintext is E of 5 fields: `YNX-CONSENSUS-HOST-KEY-PRIVATE/v1\0`, version1, complete binding wire, A DER54, B DER150. The expected binding comes from independent operator/bootstrap configuration, never an envelope preview. Both outer AAD and authenticated inner plaintext carry it. Parsed secret fields borrow one decrypted buffer so malformed parsing paths also clear that buffer.

## Recovery and durable history

`ResumeHostSigner` first detaches and validates the complete expectation and registry anchor. A read-only preflight rejects incompatible identity/version, unknown or duplicate fields, noncanonical JSON and trailing bytes. It then reads a bounded single-link regular encrypted file with mode exactly 0600, imports the fully checked key, and uses the original signer recovery body under its original OS lock. The private `resumeSigner` helper rechecks the complete expected identity and canonical state under that lock before its first durability write. Public `ResumeSigner` delegates to the same body with no custody expectation, preserving its existing API/behavior. No second H/R/S history or signature callback exists.

Missing, v1/unbound or mismatched history is an error; no replacement file is generated. Existing reserved bytes and completed signatures survive recovery. UNKNOWN remains tied to the original reservation/signature: the existing signer reconfirms the same state before returning an original-byte retry. Conflicting bytes at the same coordinates remain refused. Value copies of `HostSigner` share closure, and closing custody closes even an escaped durable `*Signer` and destroys its key handle.

This is a host-local encrypted provider, not hardware isolation. Explicit buffers are cleared on completion/error; Go/CIRCL do not promise physical erasure of every compiler/runtime copy. The original signer state and directory must remain trusted anti-rollback storage. Encryption does not detect restoration of an old valid HRS copy or grant permission to move/reset it. Concurrent trusted signer activity is serialized by the existing OS lock; the read-only preflight does not replace that lock or the original full state validation.

## Required fixed-source validation

```sh
go test -p1 -count=1 ./internal/ynxconsensusauth -run 'Test(CandidateKeyMaterial|HostKeyEnvelope|HostSigner)'
go test -p1 -count=1 ./cmd/ynx-comet
```

Test sources use freshly generated QA-only material. They cover real dual signing after strict import, malformed/inconsistent private and public keys, every binding and envelope header, wrong credential, unsafe file shape/permissions, held lock, missing or incompatible history preserved byte-for-byte, exact signature retry, conflict refusal, shared closure, reservation UNKNOWN and completed-signature UNKNOWN. A deterministic preflight-to-lock change of activation height is refused before any write, preserving both inode and bytes and releasing the original lock. A separate child process receives only the raw credential through inherited FD 3 and restores both keys plus the exact original signature; no live node is started. Runtime and CI results must be reported separately from this source freeze.
