# OPEN client DATA codecs v1

This package introduces the first explicit OPEN v1 challenge wire profile. It
reuses existing `U32BE(count) || U32BE(length) || bytes` framing and does not
change wallet-auth or original chain bytes.

- `@ynx-chain/open-protocol`: `encodeOpenEnvelope(ctx, domain, realm, fields)`
  returns a `Promise<Result<Uint8Array>>`. Only
  `YNX-OPEN/IDENTITY-CHALLENGE/1` is supported. Other profiles return
  `UNSUPPORTED`, including not-yet-defined IdentityEvent role envelopes.
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

IdentityEvent field schemas, optional-value tags and protected role-proof
validation remain separate owner work, listed in the machine-readable proposal.
