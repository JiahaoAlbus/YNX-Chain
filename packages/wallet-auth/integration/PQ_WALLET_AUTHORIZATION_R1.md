# Wallet account authorization wire R1 consumption

Chain freezes: c9ed8561318573dc559c023d0003000608393e6f (message/vector/doc),
ada7ae3a0 (query semantics). These source contracts are not a deployed API.
At the SDK validation checkpoint, actual Go cross-language comparison and
network migration were still unverified. JS comparison with the frozen unsigned
vectors must not be described as passing Go interoperability.

## Exact data and canonical conversions

The new `pq-wallet-authorization` and `pq-wallet-policy` subpaths define every
field in their `.d.ts` files. Unknown fields/getters, noncanonical hex, address
aliases, Number integers, bad lengths, trailing bytes and overflow are rejected.
U64 inputs are canonical decimal strings or BigInt; API integers are decimal
strings only. Each U64 becomes two separately framed big-endian U32 fields.
`chainId` is the preserved original genesis raw hash (32 bytes, 64 lowercase hex),
not an invented network label or the numeric EVM chain ID. `nativeChainId` stays
6423 on the existing public testnet. Canonical addresses are lowercase 0x + 40
hex digits. Display aliases must be decoded by the original address adapter.
Amounts/fees are whole native units, not Ethereum wei; current execution fee is 1.

`pqPublicBindingToRegistrationKeys` is the one backup->wire conversion: complete
2592/64-byte public keys from canonical base64url to complete lowercase hex.
`pqRegisteredPublicBinding` does the reverse from a parsed chain record, defaulting
to its active revision. A historical/pending revision requires an explicit
revision from the original protected record. A backup preview is not a source
of registration or expected keys.

## Trusted snapshot and review boundary

Original main obtains the authorization DTO with its configured trusted node
transport and calls `parsePQAccountAuthorization(raw, {chainId,nativeChainId,owner})`.
This validates immutable data and local snapshot identity; it neither authenticates
the node nor creates account authority. Keep this object in the original pending
review WeakMap. Renderer receives only display DTO/id, never bytes, guard,
credential, private handle, or the ability to recreate a snapshot identity.

The snapshot includes exact owner/network/configuration, decimal executionHeight
(node tip+1), nonce, complete ordered records, algorithm and active revision.
`enabled` means configuration installed; actual admission also requires height
>= enableAt. The active policy must be the highest revision active at that height.
Any pending migration prevents another migration; it cannot be replaced by the
classic key. The finite client history limit is 1024 records; exceeding it is an
explicit refusal, never truncation or fallback.

`planPQNativeTransfer` / `planPQAccountMigration` return the exact typed review
payload and policy dispatch. Confirmation must run inside the original
`DesktopWalletAuthority` pending-id/WeakMap permission and the same
`keyAccess.run`/`bindPermissionGuard` lease. Use the original guard before and
after I/O and signing. Re-read a snapshot before confirmation/signing and call
`assertPQAuthorizationCurrent(original, refreshed)`: ordinary monotonic height
advancement is allowed, but nonce, configuration, records, active keys/revision
or activation transitions require fresh review. Re-plan against the refreshed
height so a proposed activation that has become stale is refused.

## Fixed typed signing operations

All key handles originate from the existing protected `pq-wallet-key-backup`
adapter and same Vault custody slot. They are never caller-supplied provider
objects or a new authorization engine. The following functions contain no RPC
effect and cannot replace the original approval boundary:

- `signPQWalletNativeTransfer(activeHandle, transfer, snapshot)` checks exact
  active full keys, preserved network/account, fee and next nonce, then signs one
  TX-BATCH message. It returns a standalone N1 Member request. There is no classic
  co-signature, aggregate disguise, arbitrary purpose, or raw signing callback.
- `createPQWalletMigrationPossession(newHandle, intent)` checks the complete
  proposed pair and creates one ACCOUNT-MIGRATION Whole proof of the exact
  intent. This proves possession only, not current-account authorization.
- Before first activation, `preparePQClassicMigrationAuthorization(snapshot,intent)`
  yields exactly SHA256(full canonical intent). Only the original protected
  Wallet authority may sign that digest with the current lawful compressed
  classic key, canonical low-S DER. This helper refuses active PQ policy and
  contains no classic private key or signer callback.
- After activation, `signPQWalletCurrentMigration(oldActiveHandle,intent,snapshot)`
  signs the full intent under the active OLD PQ pair as ACCOUNT-MIGRATION Member.
  Both classic fields must be empty. New-pair Whole possession remains separate.
- `preparePQReviewedMigrationTransport(snapshot,proofs)` validates the mutually
  exclusive current-authority branch and registered full keys against the parsed
  policy, binds exact new-pair/context/N1/message bytes, and returns the request.
  Parsing itself does not assert PQ signature math or successful chain admission;
  the normal producer uses the actual typed signing functions and the node
  verifies both complete proofs before any transition.

The policy gate rejects migrated accounts at every unsupported legacy-native,
Ethereum, DEX, resource, delegation and recovery-authorization entrance. Local
encrypted backup restoration is key custody, not a legacy authorization path.
The App owner must call this gate before dispatching its old classic entry; no
SDK helper silently redirects an active account to a classic signer.

## Original persistence, transport and UNKNOWN

`PQTransportRequest` contains fixed method/path/contentType, a detached body copy
on each read, and 0x+SHA256(full original submitted wire). It performs no network
write, retries, nonce allocation, finality decision or success notification.
`preparePQAuthorizationQuery` and `preparePQOriginalLookup` likewise return only
fixed GET descriptions. Do not probe undeployed production routes as acceptance.

The normal App retains its existing FileTransactionIntentStore original-owner
engine (`reserveOriginal`, `captureOriginal`, `saveOriginal`, original readback,
rejection/resolution). Its legacy native raw schema is EVM/RLP, so the App owner
must add a strict typed PQ variant, not put PQ bytes in that old raw field or add
a parallel journal. Persist the exact signed bytes/hash and original operation
identity before submitting. A lost storage ACK requires read-only reconciliation
of that same original, not another key generation/signature/save/broadcast.

Execute a descriptor only through the original configured Native transport,
once under the same original lifecycle. On an uncertain submit, keep the same
original bytes/hash/nonce and cause. Read `/txs/{originalHash}` and the current
authorization state through that transport before any new action. A NOT_FOUND
or pending index result is not permission to repeat a write or choose a new nonce.
`classifyPQRegistration` reports only not_found/pending/active/superseded and
always sets retryAuthorized=false. Registration/admission and an active policy
are not consensus finality; existing original receipt/finality evidence remains
required. Preserve old records/history and UNKNOWN markers on restart.

## Actual SDK validation and remaining gates

New wire/policy/typed-signing/affected-cleanup controls passed in actual R24
Electron42.10/Node24.18.1. Crypto controls use fresh isolated QA keys and explicit
synthetic snapshots; they are not real registered accounts. Frozen unsigned
vectors match exactly, including values beyond 2^53. Prior backup container
controls were not repeated. No user Wallet profile or network write was used.

Remaining: original App dedicated approval/outbox variant/normal-caller adoption,
actual Go comparison and chain migration/execution/restart, trusted registration
readback, deployed version and activation heights, non-transfer PQ actions,
complete history/state replay and multi-node/consensus acceptance. Existing
installed R24 and production account state remain unchanged by this SDK source.
