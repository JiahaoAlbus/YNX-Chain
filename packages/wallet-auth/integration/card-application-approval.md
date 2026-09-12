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
