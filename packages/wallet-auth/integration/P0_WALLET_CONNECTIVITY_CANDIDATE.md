# P0 Wallet Connectivity Protocol Candidate

Status: **CANDIDATE** — this document is not an accepted contract, deployment
claim, or evidence that an installed DApp is fixed.

Canonical machine-readable proposal:
[`p0-wallet-connectivity-candidate.json`](./p0-wallet-connectivity-candidate.json).
The protocol owner owns this candidate; Integration alone may accept it and
publish its registry entry.

## Reproduction and evidence boundary

On 2026-08-20, a read-only probe of `https://wallet-auth.ynxweb4.com` returned
the remote canonical Gateway identity `wallet-quant-web-6ed04310` at
`6ed04310383ed924065d23affc71f3e4d4c29d49`, with registry SHA-256
`77880fc25bccf4df99a63b0ac4c8f81b675d180a37570bafd63bd629d21319e1`.
That digest matches the canonical form of this worktree's
`central-registry.json`. The same endpoint rejected an intentionally incomplete,
canonical completion body with HTTP 400 / `UNKNOWN_OR_MISSING_FIELD` and its
request, trace, and error IDs.

This proves that the public endpoint exposes the canonical error contract; it
does not prove a successful Wallet-controlled completion. No original Wallet
approval envelope or product device private key was available, so replaying a
real user authorization would be both impossible and inappropriate.

The direct code findings are:

- Finance converts *every* failed completion into “Device Proof rejected”, so a
  schema error, callback mismatch, expiry, registry denial, or network error is
  falsely reported as a cryptographic failure.
- Finance does not durably store a successfully completed session before return;
  the next launch can lose the apparent connection.
- Some web clients retain a non-extractable P-256 `CryptoKey` only in memory,
  which makes a callback after reload incapable of producing a later request
  proof.
- Existing Product Session code is not a standard EVM Wallet provider. Standard
  DApp connection must not be made conditional on the Gateway.

## Required behavior

There are two distinct layers.

1. **Standard Wallet Connection** is EIP-1193, EIP-6963, WalletConnect, SIWE,
   EIP-712, account/chain events, signing and transactions. It is available to
   first-party and external EVM DApps, does not require product registration,
   and exposes only the approved `0x…` account. It uses EVM chain `6423`
   (`0x1917`); `ynx_6423-1` and `YNXT` remain the chain metadata.
2. **YNX Product Session** is a first-party private-service enhancement. It
   verifies the existing exact Wallet approval and P-256 device proof, and never
   substitutes a local/bearer session. If it fails, standard connection and
   public data remain available while only the affected private service is shown
   as **Degraded**.

Every deep-link launch must first persist a short-lived pending record with the
request digest, nonce, exact callback, product/bundle identity, expiry and a
stable reference to the device key. The callback still has exactly one
`response` field; arbitrary callback `state`, redirect URLs, session values and
keys are prohibited. The callback response must resolve one exact unconsumed
pending record, after which all signed bindings are compared before Gateway
completion.

## Test vectors and consumer gates

The JSON candidate includes these required vectors/gates:

- Gateway down after EIP-1193 connection: account and ordinary signing remain
  connected; private services are Degraded.
- `UNKNOWN_OR_MISSING_FIELD` HTTP 400: classified as a protocol rejection, not
  “Device Proof rejected”, with all correlation IDs retained.
- `INVALID_DEVICE_PROOF`: classified as device-proof rejection, without a local
  session.
- callback after process restart: durable pending record and device-key
  reference resolve and complete once.
- missing/mismatched/replayed callback: no session is made and standard
  connection remains untouched.
- an external DApp obtains only the approved `0x…` account; a first-party DApp
  accepts another standard EVM Wallet.

Consumers must add executable platform-specific tests before claiming any of
these vectors. The present repository test validates the candidate completeness,
not an installed Wallet or public DApp flow.

## Migration and rollback

No client may activate this candidate until Integration marks it `ACCEPTED`.
After acceptance, consumers first add typed failure states and durable pending
records, then enable standard wallet transport, and only then opt private routes
into Product Sessions. Rollback disables Product Session issuance/private routes
only; it never removes EIP-1193/WalletConnect, invents a local session, or
downgrades canonical sessions to legacy opaque tokens.
