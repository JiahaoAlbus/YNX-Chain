# Card TEST complete source batch intake

Product source checkpoint: ceb9e02c650a9ef3b3c8faff6048e3f3c830a340/tree7aa865e95ccca9592df136f5db0a14cf041e0ab5.
Branch: codex/card-test-service-recovery-20261002.

## Executed batch

- npm test: 295 source, 39 hosted/private UI, 29 guest/application/recovery/operations integration, 11 native patch tests; 374 passed, zero failures/skips.
- node --import tsx --test server/*.test.ts: 118 passed, zero failures/skips. This includes actual local service/HTTP tests with explicitly controlled identity/signature fixtures. It is not a public user permission, live Card account or chain-funding observation.
- Frontend and separate server typecheck passed on the exact product source.
- Total across the two disjoint test invocations: 492 passed. Do not sum earlier overlapping targeted runs into this number.

## Source delivered together

Exact private source verification and safe failure diagnostics; explicit recovery task dialog with no automatic authorization; durable anonymous browser DEMO journal/controls with corruption/conflict retention; Testnet application and original-operation recovery implementation; actual client/service fixture integration; no change to shared Wallet/Auth, backend compatibility identity or scopes.

## Remaining executable acceptance gates

1. Sole release owner A: admit the exact source/tree and deliver the reviewed source-bound build to canonical Card, preserving the fixed compatibility tuple. The public backend currently admitted as e95fcf must not be falsely relabelled as a newer operations backend. If its required original-operation readback route needs a new backend release, bind that actual successor tuple before product admission.
2. Card owner after that release: directly read exact public identity/assets and exercise task-dialog dismissal/reload, browser/mobile focus/layout, Guest controls/audit refresh recovery. The confirmed old-public Guest-history loss is not closed by local tests.
3. Human-authorized Standard Wallet journey: observe actual approve/reject and stable selected provider/account/0x1917, chooser closure, refresh, account/chain/disconnect/revoke. A briefly restored MetaMask UI followed by disconnect is insufficient; do not silently retry eth_requestAccounts or bypass extension restrictions.
4. Separately authorized private Card journey: exact current identity/proof and signed TEST application details, persisted existing application recovery, actual backend acceptance/activation receipt, exact funding intent and user-approved Testnet transaction, confirmed YNXT credit, Card authorization/capture/reversal/refund, reconciliation and logout/identity isolation. Guest prepared-event logs are not that ledger.
5. Sole native release owner: actual workspace/dependency assembly, formal native compile/sign/distribution and installed TEST callback/recovery verification. Preserve existing application/keys; no replacement shell.

No formal build/deploy, new private permission, Wallet signature, Testnet send, Card activation, top-up acceptance or complete public journey is claimed by this source-batch checkpoint. No real issuing, PAN/CVV, fiat, network clearing, real merchant payments, AICardAPI or Live work is introduced.
