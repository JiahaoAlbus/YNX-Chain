# Endpoint authority v2: controlled preparation

This adds a usable signed-authority verification and issuance path. It **does not
activate** Wallet Gateway or Finance. The accepted `20260920.1` manifest, evidence,
SDK bundle, shared pin, Finance pin and Finance sources are unchanged. Their v1.1
PENDING gates still apply. No production signing key, authority signature,
deployment, installed Wallet flow or official provider acceptance is delivered.

## Owner and minimum external inputs

The current coordinator assigned shared endpoint-authority source ownership to
this task. Only the coordinator's explicitly assigned protected signer custodian
may issue a real authority. No custodian key identity is inferred from a GitHub
login, service TLS certificate, Wallet account key, SDK archive signer, or a
business/product name. Finance's sole owner adopts an accepted release and owns
its own exact consumer pin and adapter. Existing product/SDK artifact signatures
and Product Session signatures are different protocols.

Preparation and tests require no user secrets. Actual activation needs:

1. An independently reviewed **public** trust root: protected signer key ID and
   raw 32-byte Ed25519 public key, key validity/revocation, root version, an
   anti-rollback anchor, exact consumer origin/client ID/minimum version/scopes.
   Only the named custodian needs the external private-key file; do not send it
   to chat or store it in clients, source, manifests, receipts or ordinary env.
2. Fresh bounded Wallet Gateway public health **and independent version**
   observations with successful verified TLS/direct DNS, source commit/tree and
   controlled release mapping. Signed observation metadata is an issuer
   attestation; its existence cannot replace real measurements and review.
3. Finance current public source acceptance, registry/callback contract hashes,
   and actual Product Session acceptance, issued by the responsible owners.
   Endpoint authorization is independent of official Broker/Sandbox verification.
4. A reviewed consumer release with durable atomic checkpoint storage and an
   independently trusted current clock, then separate deployment/installed-flow
   evidence. Source-only verifier tests do not establish any public activation.

## Contracts

The machine-readable schemas are under `chain-metadata/endpoint-authority/v2/`.
The SDK's semantic verifier is authoritative for cross-field relations, expiry,
version comparisons, scope, signature and checkpoint checks. The schema alone
is not a verifier. The example trust root intentionally has `keys: []`, so doctor
reports `BLOCKED_NO_PROTECTED_PUBLIC_KEY`; it is not an accepted production root.

A v2 manifest has `schemaVersion: "2.0.0"`, monotonic integer `sequence`, exact
`manifestVersion: "2.0.0.<sequence>"`, and `previousPayloadSha256`. Every endpoint
is either PENDING with null evidence or VERIFIED with health/version response
hashes, timestamps, TLS/direct-DNS observations, chain 6423, exact source identity
and an offline receipt hash. Wallet Gateway's version URL must be `/version`;
health alone cannot promote it. Evidence must be at most 24 hours old when issued.
Authority validity is positive, at most seven days, and within the trusted key's
validity. URL allowlists, chain `ynx_6423-1`/6423/YNXT and disabled Mainnet remain
fixed. There is no failover, renewal or write retry.

`products.finance.status: VERIFIED` requires verified Wallet Gateway and signed
current-public-source/Product-Session acceptance at `https://finance.ynxweb4.com`.
Its `officialSandboxVerified`, `providerVerified`, and `productionApproved` are
**always false in this credential-independent protocol**. Finance endpoint access
cannot authorize a Broker account, order, Wallet signature or transfer. Those
separate product approval/feature flags and exact order confirmation remain.

The canonical payload is UTF-8 JSON with recursively sorted object keys and only
its top-level `integrity` omitted; no trailing newline. Values must be plain JSON,
integers must be safe integers, unknown fields/accessors/symbols and invalid Unicode
are rejected. Payload SHA-256 is checked independently of the signature. Ed25519
signs the UTF-8 bytes:

```
YNX_ENDPOINT_AUTHORITY_V2\n
```

followed immediately by canonical JSON of `{algorithm: "Ed25519", keyId,
payload: canonicalPayloadString}`. The displayed `\n` denotes one LF; there is
no second newline or pretty-print spacing. Signing covers the key ID and algorithm
as well as all source, evidence, consumer, time and policy fields. Signatures are
64 bytes in unpadded canonical base64url; public keys are raw 32-byte base64url.
Node 22+ and WebCrypto implementations with Ed25519 are supported. Absent secure
crypto fails closed; no application-supplied signature verifier bypass exists.

## Consumer API and durable acceptance

`validateEndpointAuthority` dispatches v2 to the signed verifier for either
`source: 'bundled'` or `'remote'`. v1.1 retains its original exact reviewed bundle
pin and only bundled mode. Both shared v2 entry points (`validateEndpointAuthority`
and `selectAuthorityEndpoint`) require an explicitly supplied trusted `nowMs`;
only v1 retains its historical `Date.now()` default. A valid v2 signature yields
an immutable, branded **candidate**, not a persistent acceptance or a user
authorization.

Prefer `createEndpointAuthorityClient` for actual consumers:

```js
import {createEndpointAuthorityClient} from '@ynx-chain/sdk';
const authority = createEndpointAuthorityClient({
  trustRoot: independentlyReviewedPublicRoot,
  consumer: {consumerId: 'ynx-finance-v1',
    origin: 'https://finance.ynxweb4.com', clientVersion: '1.2.0'},
  clock: trustedCurrentTimeMs,
  storage: {
    read: readDurableCheckpoint,
    compareAndSwap: commitCheckpointIfAllThreeFieldsStillMatch,
  },
});
await authority.accept(candidateJSON, {source: 'remote'});
const sessionContract = await authority.financeProductSession();
// sessionContract.walletGateway is an endpoint only; normal Wallet approval,
// device-proof, Gateway registry and Finance authorization checks still apply.
```

The checkpoint is `{rootVersion, sequence, payloadSha256}`. Storage must be durable
and atomic across processes/tabs. Use an IndexedDB transaction on Web or the
application's existing transactional native/backend store; in-memory state or
localStorage read-then-write is insufficient. No storage adapter is silently
invented, no consumer's existing journal is replaced, and a missing/lost checkpoint
must stop activation until restored or supplied by a separately reviewed root
anchor. Never silently reset to the example zero anchor after an accepted release.

Only the next sequence with the exact preceding digest, or the exact same already
accepted sequence/digest, is accepted. Same-version equivocation and lower sequence
are rejected. A separately reviewed higher-version root can pin a newer anchor
for an offline client; a manifest cannot choose that root. Acceptance writes the
checkpoint via atomic CAS before exposing endpoints. Endpoint lookup rereads the
checkpoint and checks expiry; a different client's newer acceptance invalidates
an old cached candidate. Concurrent acceptance failures never expose endpoints.

For low-level `selectSignedAuthorityEndpoint` / `financeProductSessionAuthority`,
pass the **fresh application-owned durable checkpoint**, never one constructed
from the manifest's sequence/hash. The higher-level client enforces this lifecycle.
The client reads its controlled clock provider at every verification, before and
after durable CAS, and on every endpoint/product lookup. Its local monotonic
high-water mark rejects clock rollback, invalidates active/in-flight use, and
survives `invalidate()` and reaccept attempts. An observed expired authority
cannot become usable again after a clock regression. This local guard is not a
persisted clock: the controlled provider must preserve/validate trusted time
across process/device restarts independently of the authority checkpoint. A
plain resettable device wall clock is insufficient. Low-level stateless calls
likewise require trusted time and cannot infer clock provenance from a number.
`invalidate()` stops current and in-flight local use.

Root rotation/revocation is an application/operator trust-policy update, not a
remote manifest field. Update the public root through the reviewed release/config
channel, atomically persist its higher root version with the existing checkpoint
(or explicitly reviewed newer anchor), invalidate old clients, and recreate them.
Never retain an old root's client after revocation. The stored root-version fence
makes old clients fail their next lookup. A revoked key cannot validate even an
otherwise unexpired document; a root-only revocation requires no new signature.

## Offline doctor and controlled issuer

`node scripts/ops/endpoint-authority-v2.mjs doctor --trust-root <public-root.json>`
checks configuration with no network calls, secret access or checkpoint writes.
`verify` (or doctor with a manifest) additionally requires `--manifest`,
`--checkpoint`, `--consumer-id`, `--origin`, `--client-version`. It returns
`VERIFIED_NOT_ACTIVATED` only after the same consumer verifier passes. The CLI uses
actual current time and has no clock override flag. It prints only status/version/
hash and bounded failure codes, not key data or input bodies.

The explicit `issue` command also requires `--evidence-dir`, `--output`, and
`--approved-payload-sha256`. It accepts only a prepared exact v2 draft with a
reviewed key ID and payload digest; `prepareAuthorityV2Draft` prepares its integrity
placeholder offline. The approved digest binds all evidence hashes and policy.
`--private-key-file` (or `YNX_ENDPOINT_AUTHORITY_SIGNING_KEY_FILE`) points to the
custodian's external PKCS8 Ed25519 PEM, private regular file 0600 owned by the
issuing process user, not a symlink/hardlink. No key-generation command is provided.
Public key must match the independently configured root. The issuer validates
receipt bytes, signs, then verifies with the consumer's verifier before exclusively
creating a new output file. It never updates current.json, a consumer pin,
checkpoint, service or release bundle. Existing files cannot be overwritten.

Receipt filenames are their exact file SHA-256 plus `.json`. An endpoint receipt
has `schemaVersion: "ynx-endpoint-observation/v2"`, `endpoint`, `source`, `chainId`,
`controlledReleaseAccepted: true`, and `health`/`version` each containing
`observation` (exact manifest projection) and `body` (exact decoded response string
whose UTF-8 bytes are hashed). A Finance receipt uses
`schemaVersion: "ynx-finance-public-acceptance/v2"`, `acceptance` equal to the
manifest Finance evidence minus `receiptSha256`, and all three provider flags
false. Receipt metadata is a reviewed attestation, not cryptographic proof of
network measurement. Do not include private account bodies, auth proofs or secrets.

## Renewal, rollback and validation

Renew by collecting new bounded evidence and issuing a new sequence with its exact
predecessor digest, new issue/expiry and current source mapping; never edit or extend
a signed release. Review/update separate roots or pins only through their owner.
Rollback restores working service code independently, then requires a new, higher
sequence authority describing the restored verified source; never accept an older
sequence or expired document. Preserve checkpoints and audit records during rollback.

Run `node --test sdk/js/endpoint-authority-v2.test.mjs sdk/js/endpoint-authority.test.mjs`
and the SDK release check. Tests generate ephemeral test-only keys in memory; the
issuer test writes one ephemeral key under an exclusive temporary directory and
removes it. No test key/public root is accepted by any live consumer. Tests cover
v1 fail-closed preservation, signed remote/bundled scope, tamper, replay/forks,
expiry, wrong consumer, TLS/source acceptance, missing/revoked keys, rotation,
asynchronous mutation, durable CAS races, restart and external-key/receipt guards.
