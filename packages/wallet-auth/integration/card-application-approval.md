# Testnet Card application approval

The SDK signs a separate off-chain Card approval under
`YNX_CARD_APPLICATION_APPROVAL_V1`. It is neither a Product Session nor a native
transfer, and it does not activate a payment card or approve funding.

After authenticating a Product Session with `card:application:write`, the Card
server supplies its current persisted challenge and the exact application
details: `nickname`, `useCase`, `limitWei`, `riskAccepted`, `termsVersion`.
The details hash matches Card's existing `digestInput` contract. Controls are
derived separately and are not included in this approval. `limitWei` remains a
positive uint256 decimal string; the helper never converts it through Number.

Wallet must show the complete details and require an explicit local approval
before calling `createSignedCardApplicationApproval({accountSecret, challenge,
details}, at)`. The helper does not display UI or attest that a review occurred.
Only the Wallet key-access layer may supply the account secret.

The server verifies against trusted current context, not fields selected by the
requesting client:

```js
const verified = verifySignedCardApplicationApproval(proof, {
  challenge: persistedChallenge,
  details: persistedDetails,
  account: authenticatedPrincipal.owner,
}, authorityNow);

const approval = {
  approved: true,
  approvalId: cardApplicationApprovalId(verified),
  challengeId: verified.challenge.id,
  owner: verified.challenge.owner,
  payloadHash: verified.challenge.payloadHash,
  expiresAt: verified.expiresAt,
};
const evmAddress = evmAddressFromYNX(verified.account);
```

`verified.account` is checked against the actual signature's compressed
secp256k1 public key, the challenge owner and the authenticated session account.
Only after successful verification is the derived EVM address a usable identity
mapping. No claimed EVM sender is accepted from the proof. This binding does not
authorize a transfer, waive a route's scopes, or replace server authentication.

The server must atomically consume the challenge and preserve its idempotency
receipt with the application update. This pure helper stores no replay state.
`parseSignedCardApplicationApproval` checks the signature and schema of historical
proofs; acceptance requires `verifySignedCardApplicationApproval` and current
time. `cardApplicationApprovalId` is a stable receipt lookup identifier, not a
chain transaction hash.

The proof has fixed approval semantics. Rejection produces no signed approval;
an unsigned rejected UI return grants no authority. Unknown fields, alternate
domains, changed details, expired challenges, high-S signatures, and mismatched
accounts fail validation. Native request routing and installed UI are separate
delivery work and are not established by these helper tests.

## Explicit Wallet review and return

After authenticating and obtaining the server's persisted challenge and details,
the Card client constructs a new pending request with fresh cryptographic
`requestId` and `state` values:

```js
const pending = createCardApplicationApprovalRequest(registry, {
  productId: "card", platform: "web", account: authenticatedAccount,
  challenge, details, requestId, state,
}, authorityNow);
// Persist the exact pending request before exposing the link to the user.
const url = encodeCardApplicationApprovalWalletURL(registry, pending, authorityNow);
```

The exact route is `ynxwallet://card-application-approval?request=...`. The
registered callback returns one `cardApplicationApprovalResult` field. Pass the
whole URL and the saved request to `parseCardApplicationApprovalReturnURL`:

```js
const result = parseCardApplicationApprovalReturnURL(
  registry, callbackURL, pending, authorityNow,
);
if (result.status === "approved") {
  // Submit result.approval through the already authenticated Card API.
  // Server verification against current persisted records is still mandatory.
} else {
  // An unsigned USER_REJECTED result cannot authorize an application.
}
```

The request and return are canonical and correlated to exact registry identity,
callback, state, account and challenge details. Correlation does not authenticate
the requesting app: Wallet explicitly labels the claimed origin as unverified.
An approval is bound to business details and the actual account signature; its
outer callback correlation is not an independent login credential.

The native controller requires the exact selected account, a confirmed backup
and the existing protected key-access operation. It consumes the request in
protected storage before signing, verifies the complete return, and persists
the exact result before opening the callback. Lock, background, account change
and uncertain storage cancel the active operation. A failed callback can retry
only its persisted result. The Card server remains responsible for durable
challenge consumption and idempotency. Tests of these modules are not proof
that a particular installed Wallet binary contains or has exercised this flow.
