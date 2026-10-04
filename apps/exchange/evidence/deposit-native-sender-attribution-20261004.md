# Exchange deposit ownership — real engine isolation correction

Predecessor b00dc8a4c3590a080f92ca721867ec9fe06ea2a2 / tree 0130503c210220ff9534f46c789414a9af5a21bf. Ordinary Exchange business/API scope, no Auth/SDK/global permissions/Host changes.

## Proven source defect

ObserveDeposit verified committed/recipient/positive amount, but public custody address and transaction hash were shared by every account. An off-chain account-owned intent alone did not bind the transfer to that actor: the native chain's From was not checked. RefreshDeposit likewise could credit a proof with empty/changed sender. Existing fixture transfers used bob as From for other actors, masking this business isolation gap.

Unmodified predecessor engine + new controlled native-account/indexer tests: three FAIL, 0.720 s. Wrong actor claim returned nil; missing sender refresh returned nil; two-actor race returned [conflict, nil], allowing the wrong actor and rejecting the actual sender. These are real Service calls/persistence in isolated temp state using existing synthetic test accounts/indexer, not a public exploit demonstration or live deposit.

## Correction

Only the authenticated native account matching the chain-proven From may observe or confirm a deposit. Empty session/sender or different sender fails ErrForbidden before balance, record, intent, audit or durable state mutation. Subsequent unconfirmed deposit refresh rechecks sender before any confirmation/credit update. Correct sender can still confirm and replay after cold New(cfg) without duplicate credit. No new grant, fake native/EVM signature, browser RPC prerequisite or privileged fixture route was introduced.

Third-party transfers are unsupported until an independently verified beneficiary binding exists; an arbitrary public transaction hash + off-chain intent must not supply that binding. Asset workflow now explains this in all 12 languages. Existing confirmed historical records/balances are not rewritten/reassigned and schema is unchanged. This patch does not establish retrospective custody reconciliation; previously queued third-party observations may now be refused rather than silently credited. Such records need explicit operator/user recovery design, not automatic reassignment.

Original four positive funding fixture locations now set From to the actual test sender. Existing assertions/amounts/confirmation requirements remain unchanged; this aligns positive inputs with the corrected business contract rather than deleting prior failure evidence.

## Real regressions and integration

- Full Go Exchange + server after fix: PASS, internal 5.874 s / server 0.517 s.
- Initial targeted -race -count=3: PASS, 2.271 s.
- Added actual Node consumer against the real Go HTTP config handler: two credential-free GETs, offline clears config, explicit refresh recovers observed fee, writes=0, writeAuthorized=false. No mocked parser/service response and no user Wallet involvement; executable marker required.
- Full Go with actual HTTP consumer: PASS, internal 9.574 s / server 0.472 s.
- Final targeted attribution + actual HTTP consumer -race -count=3: PASS, 2.782 s, four tests repeated three times. Covers wrong actor, missing sender, sender tamper, durable nonmutation, correct owner credit, second service startup/replay, and two independent actor race.
- Final relevant actual Chrome/UI suite: 15/15 PASS, 2688.282375 ms; 390/1280 controls, real modules, 12 language command copy, actual refresh button/policy, no permission/write requests, no blank tab/page errors. Controlled UI, not public/installed acceptance.
- Exact 4 page + 7 app-module cache pins PASS; Node syntax/diff PASS.

service.go blob 5a74548037f32f9e496c403ff041ad8e0ff186dd; SHA256 6252e7e762aef220534f1b986f145b605b14a2a27105257d5ba9b62ba0f5787a.
app.js SHA256 6830322df2c9c02769472b3b0c66b515cce313331d5357ebd22e31d0c861a400; command-copy.js SHA256 a008ce04065ae1ea734c597b744b855490c8ca1caddee92a540f56284ea4d095; HTML/import hashes updated.

Runtime publication, native chain proof trust/custody evidence, accepted canonical write-route registration, real user approval/signature/financial operation, Product Session migration and full product completion remain unproven. Existing main explicitly keeps public execution closed until actual product-owned Strategy Vault evidence, not an environment claim; this patch does not widen that gate. Full historical P0 helper identity mismatch remains retained.
