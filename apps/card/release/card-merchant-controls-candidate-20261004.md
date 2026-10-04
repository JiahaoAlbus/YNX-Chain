# Card merchant controls and emergency policy candidate

Product source: `cb8b23ea1f2d8a3f8c8d7fad6f818fd2193efd92`.
Tree: `18f58a15937f95aa958fe45890041648ce6d1a50`.
Branch: `codex/card-test-service-recovery-20261002`.

## Product change

The actual encrypted SQLite Card service now supports a simulated-merchant allowlist and independent emergency blocking. Explicit merchant denial wins over allowance. Emergency blocking declines new authorization attempts without silently releasing existing holds or blocking capture/reversal. Frozen/closed lifecycle still has priority. Existing records missing the optional new fields retain historical behavior and accept an explicit validated controls update without a database rewrite or schema reset.

The existing private Testnet action dialog exposes allowed merchant IDs and an accessible checked/disabled emergency switch, in all twelve supported locales. A blank optional amount preserves the current single-transaction limit. Controls load from the current selected card. Input IDs, count and duplicates are validated before journaling. Submission requires the existing explicit confirmation, confirmed local journal write, exact operation digest/idempotency key and Card API scope. Unknown outcomes keep the original request; no automatic retry, account request, signing or funds movement was added.

## Evidence

- Backend risk/service/new durable controls suite: 37/37 passed; actual original CardStore, with explicit test-only Wallet/Core authority seams. No real approval or funding proof.
- UI/input/journal suite: 21/21 passed. Covers explicit confirmation, exact new input in digest/history, invalid-input no-dispatch, existing expiry/client/owner/card recovery and selected-language errors. Renderer fixtures only, not public approval evidence.
- Frontend/server typecheck passed after correcting the test's Node TestContext annotation. New UI test label corrected to the existing Spending limit action; product labels were not guessed or replaced to accommodate the test.
- Exact committed source Web build passed; generated envelope build passed 16/16 file set and static parity 13/13.
- Matching backend main bundle: 282228B; SHA256 `5db7a9915e1ee89ff361fac040545c00e51ea84b4486aac9e2b210c026ff561a`; 20 owned source inputs / 15 external imports; compiled source identity. Backend not started, SDK not executed.

Full source and artifact hashes: `../evidence/20261003-testnet-operations/paired-composition-cb8b23ea1-20261004.json`.
Candidate root: `/private/tmp/ynx-card-paired-candidate-20261004.0FYT51`, envelope `envelope-cb8b23ea1`, backend `backend-cb8b23ea1`. The cfb999b28 candidate and all earlier failed logs remain preserved. No previous public/QA browser evidence is relabeled as this new source's private control verification.

## Delivery boundary

This is a prepared owned candidate, not a formal publication or completed Testnet product. No alias/deployment/Host mutation occurred. Last direct public readback in this batch still identified frontend661265137/backende95. A read-only latest shared-owner thread snapshot concerned Chain/website work and did not provide Card runtime admission inputs; it is not proof those inputs exist or that the formal Host is ready.

Remaining original runtime dependency: genuine captured-current producer and accepted Wallet/Auth role/actor authorization at protected startup. No substitute producer is synthesized. `publicRuntimeVerified`, `realWalletApproval`, `realSignature`, `realYNXTTopup`, `realPrivateApproval`, `realCardApiReadback`, `productsConnected`, `migratedV2`, `ComputerControl` and `productionRealPayments` remain false. No PAN/CVV, fiat, bank network or real merchant payments. Full Testnet E2E and Data Fabric direct acceptance remain open; do not announce `YNX_CARD_TESTNET_PRODUCT_READY`.
