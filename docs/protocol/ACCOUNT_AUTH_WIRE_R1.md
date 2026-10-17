# Account authorization wire R1

This freezes application message bytes for Wallet SDK implementation. Chain
integration is source-only until the Go guard permits compilation and tests.
It is not a production registration endpoint or network activation announcement.
The production source base is `65efa82e06158f9616172144c3c9efdd8088f227`.

## Original identity and framing

`chainId` is exactly 32 raw bytes of the existing genesis block hash, obtained
from trusted node configuration/state. It is never derived from an account,
mnemonic or service-supplied arbitrary network name. `nativeChainId` is the
unchanged numeric network ID (public testnet 6423). Both are signed in a native
transfer. Registering keys changes no address, balance or history identity.
The owner/from/to are canonical lowercase `0x` plus 40 lowercase hex digits.
Display Bech32 aliases must be decoded to this original address before signing.

`E` is the unchanged protocol framing: U32 field count, then each U32 byte length
and raw field bytes. U32 means exactly 4-byte unsigned big-endian. Every ledger
U64 is represented by **two separately framed U32 fields, high then low**.
JS callers use BigInt/decimal strings and must not round through Number.
All text below is literal ASCII. There is no JSON in cryptographic messages.

## Transfer message (13 fields)

`E("YNX-NATIVE-TRANSFER/v2", U32(2), chainId32,
nativeChainId.high, nativeChainId.low, from, to,
amount.high, amount.low, fee.high, fee.low, nonce.high, nonce.low)`

Amount and fee retain existing whole-native-unit semantics; amount is positive,
amount+fee must fit signed int64, and the actual ledger requires fee=1. From and
to must differ; nonce equals current ledger nonce+1 without overflow. Signature
context purpose is `TX-BATCH`; context owner must equal from. The first standalone
native route accepts N=1 only. Complete batch admission/execution will be a
separate extension; a hidden member cannot establish the whole aggregate bound.

## Registration intent (15 fields)

`E("YNX-ACCOUNT-REGISTRATION/v1", U32(1), chainId32, owner,
"YNX-BATCH/v0.1", pkA2592, pkB64,
priorRevision.high, priorRevision.low, newRevision.high, newRevision.low,
ledgerNonce.high, ledgerNonce.low, activateAt.high, activateAt.low)`

Revision starts at prior=0/new=1, then increases exactly once. The complete pair
must be present. Ledger nonce is consumed once; the migration fee is 1. The
activation height must exceed its admission/execution height. A pending revision
cannot be replaced or cancelled with a classic key. Historical records remain.

New key possession is a **one-message WholeWire**, signed with the proposed pair,
purpose `ACCOUNT-MIGRATION`, context owner/network and both keys exactly matching
the intent. The sole complete message is the intent above. This proves key
possession only; it is not an existing-account authorization or trusted registry.

Before the account's first PQ activation, lawful current authorization is the
existing compressed secp256k1 public key (33 bytes), matching the original
Keccak-derived address, plus canonical low-S DER signature of SHA256(full intent).
After activation, current authorization is a MemberWire under the active old PQ
pair, with the same `ACCOUNT-MIGRATION` purpose and exact full intent. Both classic
fields must then be empty. New-pair possession is required in either case.

The complete migration request (6 fields) is:

`E("YNX-ACCOUNT-MIGRATION/v1", intentBytes, classicPublicKeyOrEmpty,
classicSignatureOrEmpty, currentPQMemberOrEmpty, newKeyWholeProof)`.

Maximum request size is 256 KiB. No private key or PKCS8 appears in this request.
Recovery imports the encrypted backup through the existing SDK and compares both
recomputed public keys against original and trusted registered records before
using the active-policy signing path. An old mnemonic cannot recover PQ authority.

## Source API contract (not yet compiled or deployed)

- `GET /accounts/{canonicalAddress}/authorization`: public state from one lock;
  `owner`, decimal-string `executionHeight`, `ledgerNonce`, `enabled`,
  `algorithmVersion` (`legacy` or `YNX-BATCH/v0.1`), and `records`. When enabled,
  also `policyVersion`, lowercase raw-genesis `networkId`, decimal-string
  `enableAt`; active accounts include decimal-string `activeRevision`.
- Each record has `algorithmVersion`, `owner`, complete `pkA`/`pkB` lowercase hex,
  and decimal-string `revision`, `registeredAt`, `activeFrom`, `ledgerNonce`.
- `POST /accounts/{canonicalAddress}/authorization/migrate`, content type
  `application/octet-stream`, body the full migration wire above. Successful
  registration returns existing transaction DTO and `replayed`, decimal-string
  `activationHeight`/`revision`. Registration is not activation/final confirmation.
- `POST /transactions/pq/broadcast`, content type `application/octet-stream`,
  body standalone N=1 MemberWire. Returns existing transaction DTO and `replayed`.
  Its signed full message is the transfer described above, without classic proof.
- Existing transaction reads `/txs/{hash}` and existing durability/UNKNOWN
  semantics remain authoritative. A successful admission response is not consensus
  finality. Reconcile an uncertain original hash before any new nonce/action.

Transport hashes are `0x` + SHA256(full submitted wire), used for identity and
idempotency, never substituted for either protocol tree's full signed message.
The RPC is a transport; the caller must use its existing trusted network binding.
A hostile response or self-verified backup public key is not chain authority.

`--pq-admission-height` is a node/operator future immutable schedule, not a public
account endpoint. No deployment height is selected here. Until that schedule is
installed, new PQ requests reject. Historical classic entries remain readable.
After an account activates, legacy native/Ethereum/DEX/resource/delegation paths
must reject new authorization until a complete PQ action path is implemented.

## Codec vectors and remaining acceptance

`internal/ynxauth/testdata/wire-v1.json` contains unsigned synthetic message vectors
including U64 values beyond JavaScript's exact Number range. They were generated
with the frozen JS protocol framing. Go comparison tests have been prepared but
not run. These bytes are an integration contract, not an account or signature.

Required follow-up: actual Go compilation and vector comparison; true migration,
nonce/fee execution and restart; SDK/App chain-registration comparison; complete
batch admission and non-transfer PQ actions; public-history replay and all-module
state conversion; validator consensus wiring and multi-node acceptance. Existing
Comet migration export omits several production modules, so it cannot establish
full-state continuity without further implementation and verification.
