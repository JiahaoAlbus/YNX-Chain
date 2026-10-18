# Original NodeHost account context hook R1 — SDK 1.3.0-pq.3.1

The original NodeHost, private Native-owned transaction, atomic state file,
kernel and HTTP handler remain the only session engine. This release adds the
missing request-local policy port; it does not replace the server or supply a
Source/Native grant. R3 remains frozen as its own predecessor.

## Fixed normal service configuration

`ProductSessionGatewayNodeHost` options accept one additive property:
```
accountPolicy: {
  mode: 'required',
  run: async (operation, execute) => { /* resolve undefined only */ }
}
```
This is a fixed protected service import/configuration, never an HTTP argument
or user-selectable opt-out. `run` is the original Auth normal glue. It acquires
the fixed r13 factory resource for the account and operation, retains every
partial original, captures the SDK observation, and verifies a PQ approval when
needed. Initialization can throw an Error whose own non-enumerable data property
`partial` is the original resource; retain it before any current/readiness check.
Do not replace it with a public DTO, catch it into a legacy fallback or acquire
another resource automatically. `mode:'required'` cannot be set to false.

The immutable `operation` contains:
`requestId, method, path, body, proofHeader, walletControlProofHeader, session, at`.
`body` is the original bounded request string; `at` is canonical ISO. `session`
is the original stored session selected by the device header, or null. These
are lookup/binding context, never evidence of registered policy or a grant.
The existing engine still verifies exact request, account, proof and scope.
`operation.at` is metadata only. At actual execution the Host reads its clock
again; required-mode direct revalidation also uses its own fresh clock rather
than accepting an old external at across async Source acquisition. Auth captures
and reads the observation at its actual current clock, not the arrival time.

Auth owns resource recheck/current/first deadline and cleanup. After pre-recheck,
it calls `execute({observation,verifiedApproval,required:true})` synchronously,
exactly once. `execute` returns undefined; the original Host alone creates,
persists and returns its actual response. `run` post-rechecks and resolves only
undefined. It cannot supply a response or a replacement handler. Missing,
false-required, double, late and suppressed execution refusals cannot succeed.
The continuation closes when `run` settles, even on error.

The Host snapshots current state at the actual synchronous continuation, so
async source acquisition does not retain an obsolete per-user handler. The
original atomic transaction persists before publishing its result. After each
transaction, the global Host retains only the durable snapshot with empty
required context; it never retains a user's observation or verification token.
Cold construction also starts empty. The original idempotency cache rechecks
the current request-local policy before returning historical success.

If post-recheck/cleanup fails after execution, HTTP success is withheld but the
original persisted result and replay/idempotency state remain. This is not an
automatic rollback or permission to re-execute. Auth retains the original
requestId/resource/first cause and cleanup debt; reconcile the original stored
outcome read-only through existing recovery. Never retry an unknown effect as
a new request or discard a retained result to manufacture a clean failure.

## Synchronous trusted/private consumers

`host.revalidate(session, scopes, productId, at, businessRevalidation, context)`
borrows a new request-local context. In required mode, omitting it fails;
an earlier HTTP request never installs a default context for subsequent reads.
The original async Auth caller obtains/rechecks before and after this sync call.

`executeOriginalWalletServicePrivateTransaction(owner, context)` and
`handleOriginalWalletServicePrivateRequest(input, retained, association, context)`
remain synchronous. All original Native association, terminal journal, owning
readback, partial result, UNKNOWN and close rules remain intact. Context grants
none of those qualifications. Clock-only private reads still grant no account
session. Existing legacy private body/envelope bounds remain 49,152/65,536.
The SDK's purpose/version-limited V3 carrier now supports the full N1 proof;
see `PQ_PRIVATE_CARRIER_V3.md`. The old Native binary does not support it and
must reject it. This release does NOT establish Native-private PQ acceptance.
It requires the original Native writer's matching purpose-limited adapter and
matching assembly; HTTP keeps its existing 1 MiB bound. The original dispatcher
awaits `executeOriginalWalletServicePrivateTransactionWithPolicy(owner)` around
the same synchronous Native transaction, using the same fixed normal runner.
It captures partial results and preserves UNKNOWN before any late failure.

## Alternate routes and compatibility

Required mode rejects central-browser authority routes with
`ACCOUNT_POLICY_CENTRAL_CONTEXT_NOT_SUPPLIED` until those original transactions
have their own proper context integration. The daemon cannot delegate other
legacy authority routes around the required policy check; it rejects with
`ACCOUNT_POLICY_LEGACY_ROUTE_NOT_SUPPORTED`. No opt-out boolean is supplied.
Source-current and unauthorizing clock/preflight reads retain their existing
contracts. Historical service mode remains unchanged. In required mode, the
normal v2 product routes still accept lawful classic approval when the real
current policy is legacy; after PQ activation, cached classic success is refused.

## Original Wallet main helper gaps

`pqProductSessionRegisteredPublicBinding(observation, originalYNXAccount, at)`
in `product-session-account-policy` reads the same current committed observation
and returns the complete backup/Vault PQPublicBinding, matching both registered
keys and preserved owner/network. It never invents a nonce/R2 execution DTO or
uses a backup preview as registration authority. Supply this exact binding to
the original Vault `withPQKeys` guard.

For the first lawful classic migration, the original signer signs the exact
digest from `preparePQClassicMigrationAuthorization` once, without a personal-
message prefix or extra prehash. Main captures only its public result:
`{publicKey:'0x...',r:'0x'+64lowerHex,s:'0x'+64lowerHex}`. SEC1 publicKey may be
compressed or uncompressed. Call `preparePQClassicMigrationProof(snapshot,
intent, signatureResult)` in `pq-wallet-policy`. It checks the same original
migration plan and refuses active PQ before inspecting the signer result, then
uses the existing exact Noble dependency to compress the public key, require
low-S/range-valid canonical DER, verify SHA256(full intent), and match original
owner. It returns independent Uint8Array copies named classicPublicKey and
classicSignature. It has no private key, callback or second signer. High-S is
refused, never silently normalized. New-pair PoP remains a separate dual proof.

## Original callback codec

The existing `createProductSessionReturnURL(registry,request,result,at,verified)`
and `parseProductSessionReturnURL(registry,request,url,at,verified)` take an
additive fifth main-only verified capability. They still use the original
approval parser, exact callback/nonce/state binding and canonical codec.
The capability never enters JSON or the URL. A receiving Node process must
obtain its own normal-source observation and verified capability; it cannot
reconstruct the sender's capability from the public callback or use a clone.

Full V3 proof callback encoding exceeds the old 4,096-character route bound.
Only the verified V3 codec allows a bounded 262,144-character representation;
historical V2 and no-capability paths retain 4,096. Component encoding/parsing
does NOT prove that an OS scheme handler, browser or HTTP proxy delivers this
large URI. Their actual limits remain a separate normal-flow gate. If a target
rejects it, the original Auth/router/pending owner must agree a reference-based
return path retaining the original proof; App must not invent a callback
encoder, omit signatures or put capabilities into transport.

The existing protected completion-record format is also still bounded to
16 KiB and uses its original classic validation. This release does not silently
widen that format or claim full browser/native client pending-completion
recovery for V3. The tested cold recovery here is the actual original Gateway
state file; consumer completion transport/storage remains an explicit gate.

## Admission still open

Component tests use isolated QA keys and explicit synthetic resources with the
actual original NodeHost/listener/filesystem. They do not admit a live node,
registered account, original Auth profile, Native module or published App.
Original Auth r13/r14 fixed source and matching healthy deployed Chain query
must still supply real resources; original App/server consumers must import
this exact package and retain their original permissions/persistence/cleanup.
