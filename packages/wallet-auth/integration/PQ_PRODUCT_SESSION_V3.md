# ProductSession account approval V3 — SDK R3

This is an extension of the existing ProductSession state machine, challenge,
device proof, durable nonce/replay fence, session snapshot and revocation paths.
It is not a second login engine. Request and P256 device protocol remain V2.
The account approval and resulting session are V3 for active PQ accounts.
The preserved original YNX address is converted with the existing address
codec, never rederived from a new PQ key. Both registered keys must match.

## Entry points

Node-only `@ynx-chain/wallet-auth/product-session-pq-approval` exports
`preparePQProductSessionApproval` and `verifyPQProductSessionApproval`.
Its browser condition is explicitly unavailable. It uses the one exact
optional peer `@ynx/batch-v01-candidate@0.1.0-candidate.2`, portable provider.
There is no fallback. Root/browser session imports do not import this provider.

`@ynx-chain/wallet-auth/product-session-account-policy` exports borrowed-resource
capture/read and its exact types. Resource provenance is supplied only by the
fixed original Auth factory, not by this structural SDK boundary. The resource
must follow `PQ_ACCOUNT_POLICY_RESOURCE_R1.md`. It is not IDE/Native authority.

`signPQWalletProductSessionApproval` is added to the existing Node-only
`pq-wallet-key-backup` entry. It takes the original protected-main key handle
and an opaque review plan, never a raw message, renderer key, generic signer
callback or invented permission. Call inside the original pending WeakMap,
Vault keyAccess lease and permission guards, asserted before and after signing.

## Exact account proof

Purpose is `PRODUCT-SESSION-APPROVAL`. Message is unique-provider E framing:

1. UTF-8 `YNX-PRODUCT-SESSION-APPROVAL/v3`.
2. provider U32 big-endian integer 3.
3. UTF-8 canonicalJSON of the complete parsed original request, including
   purpose, nonce/state, product/device/origin/callback, scopes and consent.
4. UTF-8 canonicalJSON of the unsigned V3 approval.

Unsigned approval is the original parsed request bindings, replacing version
with `3`, excluding request purpose/issuedAt/expiresAt (the full original
request is separately signed above), and adding result, requestDigest,
preserved account, accountAuthorization and approval issuedAt/expiresAt.
accountAuthorization contains exact policy/algorithm/network/owner/revision/
registeredAt/activeFrom and both full registered public keys. No classic
account public key or account signature field is accepted. Finite consent
requires explicit matching approvedServiceConsent when preparing the plan.

The provider N1 Member proof uses original genesis chain bytes, preserved 0x
owner and fixed purpose; index=0 and both paths empty. `walletProof` is canonical
unpadded base64url of the full Member. The verifier binds every field and the
full message, verifies both signature branches, and fences the original source
before and after crypto. Its opaque verified capability binds the complete
approval, request digest and original resource. Cloning a public approval or
restoring JSON cannot recreate this capability.

The provider's numeric execution coordinate 0 is a local signature-check
coordinate only. Full U64 activation and committed height are checked as exact
decimal strings by the original policy boundary; they are never rounded to
Number or represented as a finality proof.

## Original state machine and calling closure

Borrow the normal Source resource and capture the original observation. Prepare
and show the review, explicitly approve it, recheck the same resource, assert
the original permission, sign with the existing Vault handle, assert again and
verify. Nothing here creates approval merely from a displayed plan.

After verification use request-local context:
```
const context = {observation, verifiedApproval, required: true};
const authority = new ProductSessionAuthority(registry, snapshot, context);
// Or the same original kernel/HTTP handler, fifth constructor parameter:
const http = new ProductSessionGatewayHttpHandler(
  registry, tokenFactory, gatewaySnapshot, capacityPolicy, context
);
```
Before and after each original transaction, the host awaits the same original
resource recheck, fences the permission and retains its original persistence/
UNKNOWN handling. Snapshot atomicity remains the host's existing transaction.
Do not install one account's context as a global multiuser resolver. Capture a
fresh normal resource for each account/operation and each cold restore. Context,
review plan, key handles and verified capabilities must not be serialized.

Authority issue/complete/introspection and Gateway cached success enforce the
same current policy. Cold Gateway construction, rollback after refusal and
control-store projection retain the request-local context. Active PQ policy
rejects valid classic approval before issuing a challenge. Existing device
revocation and replay controls remain in the original state machine. The old
global classic Wallet owner-control proof is explicitly refused for an active
PQ account when this required context is supplied; no classic fallback is
created. A PQ global owner-control proof is not supplied by this release.

Stored V3 session adds only accountAuthorization. Challenge and deviceBinding
retain V2 domains; approvalDigest uses V3 domain, binding its full proof and
pair without inflating every business device-proof header. Historical V2 data
parsers and old optional constructor arguments remain compatible. Returning a
parsed session from JSON never proves live policy or authorization.

Original host retains partial resources, first failure, signed outcomes and
UNKNOWN debt. Retire synchronously; join entered operations; close only after
successful join. Never substitute a new resource/deadline or replay a write
because a late current/recheck/close failed.

## Actual release limits

R3 supplies source, typed public API, packaged proof and existing Authority/
Gateway/HTTP crypto/state-machine calling closure. Existing deployed NodeHost,
browser callback, App normal review and other consumer assemblies must still
inject the original normal resource/context inside their own original
transactions. Their default historical constructors do not magically query a
chain or enforce a policy that was never supplied. Such an assembly is not
admitted as an upgraded service until normal integration and real account QA
complete. No existing R2/R2a ABI or App 316-file package is silently replaced.

Current Auth r12 normal factory refuses
`AUTH_ACCOUNT_POLICY_COMMITTED_SOURCE_NOT_SUPPLIED`. Real canonical genesis,
healthy deployed committed query, completeness, durability, anchor continuity
and current policy are still required. Component QA uses clearly labelled
synthetic original resources with isolated fresh keys; it is not chain
registration, real Source enrollment, Native qualification or public acceptance.
SDK20/r6a IDE parent remains unchanged, with its independent Source admission.
