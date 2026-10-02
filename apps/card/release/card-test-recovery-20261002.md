# Card TEST recovery checkpoint, 2026-10-02

Status: IN_PROGRESS, not release-ready. Scope: apps/card only.
Owner branch: codex/card-test-service-recovery-20261002.
Source base: b5c44d3549be3cd22a9d33dd98927e32be4922ee.

## Direct public observation

Public origin: https://card.ynxweb4.com/.
Observed frontend identity: 7f9ea9af369c61fcb358c9e80500fdd30c66cbbb.
Observed TEST backend source: e95fcf443228d0db97c139dfa5e8ad6fbb7aa675.
HTML: 1717 bytes, SHA256 e47a3539452dbd7991f79ea5eea3256d6f8b0b4ddc7446e88e5d39d022ea6ba5.
Actual compiled JavaScript: 4267594 bytes, SHA256 17276cbae9dd86eefe4b2a1f97edb3f8b0c85c04eed65a4a111f3775a970b05f.
Asset: /_expo/static/js/web/index-ad5868816fd7a4dfcab6df15c5f9e90d.js.
The compiled guard still requires frontend sourceCommit equal backend sourceCommit and throws CARD_API_SOURCE_MISMATCH. This is actual JS evidence, not an inference from identity metadata alone. A must publish compatible compiled JS and runtime identity together. A JSON-only update is insufficient.

Current-run screenshot: /private/tmp/ynx-card-recovery-20261002/public-before.png,
116374 bytes, SHA256 9bb1492911b65939d8f2f03f91686bfb464ab1dfed3555ea7c58ca887fb7e728.
Chrome used an existing profile; its saved Chinese preference is not a fresh-default-language test. A previously approved standard account later restored without an owner account request. No account approval, signature, transaction or application write was performed in this audit.

## Owned changes, not publicly published

- Provider API operations bind the current owner, session binding and expiry throughout proof, fetch and body parsing; bounded timeouts and explicit invalidation prevent late cross-owner records.
- App and provider UI invalidate old clients and hide stale records immediately on identity/session change.
- Dynamic private-service copy uses Card-owned localized messages rather than displaying remote English messages inside another locale.
- Web application approval fails before a preparation mutation or custom-scheme launch. A-owned Hosted CardApplicationApproval transport remains unavailable.
- Unsupported finance sharing fails before revoking an existing base private session or expanding scopes. No registry or shared protocol changes.
- Account-change pause has verified local and tab markers. Local write failure can fall back to a verified tab tombstone. If neither store can persist a tombstone, current-runtime proof is blocked and an explicit error is reported.

## Accepted compatibility decision

The continuing audit owner explicitly accepted requiring both local and tab markers: legacy private sessions lacking a tab marker do not automatically restore. Their protected SDK records are retained and users can explicitly review Card access again. This does not change standard Wallet connection. Local pause is not backend revocation; explicit disconnect still uses the real SDK route and propagates revocation failure without reporting success.

There is no durable isolation proof when both stores reject writes and a reload preserves both stale yes markers. A real cold browser restart without tab storage is blocked. Do not report all storage-failure recovery cases as proven.

## Regression evidence

Original failed logs are retained without modification under /private/tmp/ynx-card-recovery-20261002.
Earlier successful source gate: 236/236; App: 32/32; native patch: 11/11; TEST backend: 107/107; typecheck and security passed.
card-final-tests.log: 239/240, new callback fixture used a noncanonical parameter.
After explicit approval, that fixture uses the existing result parameter and retains its rejection assertion.
card-approved-tests.log: 241/242, sole failure is the legacy automatic-restore expectation versus the new fail-closed tab-marker policy. Typecheck passed before this run. No formal build or release artifact was produced.

Final concentrated regression after the accepted compatibility change: source 244/244, App 32/32, native patch 11/11, zero skips; TEST backend command passed; typecheck and security passed. Logs: card-concentrated-tests.log and card-concentrated-service-tests.log in the evidence directory above. Tests are synthetic source gates, not proof of public backend approval or revocation.

## Authority and truth gates

A wallet_release_owner exclusively owns shared transport, canonical registry changes, formal builds and public deployment. Report issues to the continuing audit chat, not the former audit chat.

New owner source publicly deployed: false.
Hosted application approval verified: false.
Current-owner public private API lifecycle verified: false.
New application approved or ACTIVE card created: false.
Real YNXT funding/top-up verified: false.
Real card, PAN/CVV, fiat or merchant settlement: false.
Full installed/public product completion: false.
MONSTER execution: NOT_RUN.
