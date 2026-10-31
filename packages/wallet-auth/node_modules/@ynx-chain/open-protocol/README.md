# OPEN client DATA codecs v1

This package introduces the first explicit OPEN v1 challenge wire profile. It
reuses existing `U32BE(count) || U32BE(length) || bytes` framing and does not
change wallet-auth or original chain bytes.

- `@ynx-chain/open-protocol`: `encodeOpenEnvelope(ctx, domain, realm, fields)`
  returns a `Promise<Result<Uint8Array>>`. The typed challenge
  and four explicit identity-role domains are supported. Undefined profiles
  return `UNSUPPORTED`.
- `./identity-challenge`: typed `encodeIdentityChallengeV1DATA`,
  `decodeIdentityChallengeV1DATA`, and `assertIdentityChallengeV1BindingDATA`.
- `./framing`: generic E control framing with 1 MiB/1024-field limits.
- `go/`: matching standard-library-only codecs and public wrapper.

The challenge has eleven positional fields: domain, realm16, network binding,
tenant16, subject `E(agentId16, epochU64BE)`, audience16, fixed purpose
`YNX-OPEN/IDENTITY-AUTH/1`, channelBinding32, nonce32, issuedAtU64BE and
expiresAtU64BE. Timestamps are Unix milliseconds and lifetime is in `(0,60000]`.
The public `fields` argument contains the last nine fields, after domain/realm.
Public ctx/realm IDs are lower-case hex32 display strings, encoded as raw16.

`encodeOpenEnvelope` checks ctx realm and tenant. A syntax-only typed decoder
cannot detect exchanging two otherwise-valid same-width IDs. The Auth consumer
must compare the original selected realm/tenant/subject/epoch/audience/channel
and network binding using the expected-binding DATA assertion before admitting
anything. The codec itself does not establish current identity, trusted clock,
challenge single use, channel authenticity, signatures or permission.

Auth has confirmed the new challenge physical mapping. A genuine Agent
transport instance is still not supplied; an HTTP client's self-reported
channel hash must never become a trusted channel. Actual Auth02/03 and OPEN
business admission are not proven by these codec tests.

The old committed YNX-BATCH Context vector tests generic E compatibility only.
The two new synthetic-identifier vectors test this new v1 profile in both Go
and TS. Neither set is a signature, Source grant or production result.

The newly defined IdentityEvent field schema and presence tags are implemented
below. Protected role-proof validation remains original Auth owner work.

## IdentityEvent and role authorization v1

Package dev.2 adds the explicit new IdentityEvent E10 schema and four distinct
role-auth E10 domains. Public encodeOpenEnvelope accepts eight fields after
domain/realm for those roles. It binds the selected ctx realm and the original
event subject tenant, plus exact outer/inner action/realm/from/to generations.

The inner event uses subject Ref E(realm16,tenant16,agent,id16,revU64BE), explicit
one-byte presence tags for newPair/previous, and a byte-length + both digest
binding. register is 0 to 1; every nonregister action, including suspend/revoke,
is strictly +1 with overflow refused and previous present. Pair material is
mandatory only for register/rotate/recover. subjectRef.rev is not inferred to
equal epoch. Old pair history is retained by Auth, never erased by this codec.

Role DATA admission is action-specific: register controller/newPoP; rotate
controller/oldPair/newPoP; suspend/revoke controller; recover recovery/newPoP.
This matrix is not a completed AND or threshold authorization: Auth must still
require every necessary proof, independent preregistered recovery controllers,
unique threshold members, current head and policy. A revoked identity is never
revived merely because an event encodes successfully. No account asset-key
authority is introduced. Protected signing, trusted Source/channel and genuine
identity transitions remain unverified external effects.

New five-event and nine-role synthetic vectors are a new schema interoperability
fixture, not a signature result or prior production qualification. Challenge
v1 bytes and its separate domain remain unchanged.
