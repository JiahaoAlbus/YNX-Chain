# Card Guest durable recovery: actual public failure and owned repair

Branch: codex/card-test-service-recovery-20261002. Prior head: 1e060da9a0233cd3d8a83b000134d28eb661ebf1.

## Actual canonical Chrome observation

On the original https://card.ynxweb4.com/?verify=card-test-account-20261004 tab, the owner ran Try demo, authorization, capture, reversal and refund. Each appended a DEMO workflow-prepared event, with explicit no transaction/balance/merchant settlement language. These are demonstration audit entries, not a financial state machine or accepted Card backend operations.

Reloading the same page then selecting Activity lost all five events. Before/after screenshots and redacted AX transitions are preserved in chrome-guest-lifecycle-recovery-20261004.json. This is a confirmed Guest persistence defect in the last independently verified public 661265 release, not a user-account deletion.

The same reload briefly displayed MetaMask, an account and 0x1917 before subsequently disconnecting. No approval/rejection action was observed. A connection-details click found no matching control after the state changed. This cannot support stable connection, actual new approval or complete refresh/disconnect lifecycle acceptance. Account addresses are redacted in committed evidence; no repeat request, signing or transfer was executed.

## Implemented repair

- GuestExperience now consumes a separate anonymous DEMO-only browser journal for local audit and control restoration. Native surfaces truthfully remain temporary; this does not create a native private account store.
- Only exact, enumerated demo event labels/details, safe unique IDs, simulation=true and three boolean demo controls may be restored. No wallet identity, balance, PAN/CVV, chain transaction or account authority is stored or inferred.
- Maximum persisted history is 100 events. Corrupt/foreign/oversized existing values are retained without overwrite or reset. Concurrent browser writers compare the original storage value before writing; conflicting changes do not replace newer history.
- A write must read back exactly before being called saved. Quota/denied/silent failure and conflicts produce localized, live-announced preserved/temporary feedback; interactive in-memory demonstration remains separate from saved records.
- No clearing of private journals, recovery tokens, registration drafts, wallet state, service-worker caches or existing keys. No automatic authorization or Card operation replay.
- All twelve locales include exact registered storage feedback. The first 12 localization-directory failures were preserved and the visible-text test directory extended with the specific three localized messages, not a generic exception.

## Executed gates

npm test: 295 source + 39 hosted/private + 25 guest/application/recovery/operations + 11 native patch = 370 passed, zero failed/skipped. Frontend and separate server typecheck passed. Initial failure log and final passing logs are retained under evidence/20261003-testnet-operations.

The new source has not been formally built or deployed by this owner. The sole release owner must bind its exact source/tree through the existing reviewed runtime pipeline and deploy the canonical Card surface. Then repeat the actual Guest sequence and refresh, verify controls persistence, language feedback and no account/chain authority leakage. Do not claim the public defect closed until that directly passes.

Card backend tuple, shared Wallet/Auth scopes, real application approval/receipt, Testnet transaction credit, private simulation ledger and formal native delivery retain their existing independent gates. No real issuing/fiat/real payment, AICardAPI or Live capability is restored.
