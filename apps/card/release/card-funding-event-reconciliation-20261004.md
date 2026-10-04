# Card funding receipt and event reconciliation

Source415b54bdcaf7164f1dedc9f8fd74863b21737a9d/tree d858c6c173ce05cab9ca692bcd8006002f4714ee. Retains existing authenticated /api/card/v1/cards/:id/reconciliation route, scope checks, owner storage/current fences and ledger conservation checks. No new public route or external event contract.

Existing receipt reconciliation checked sender/recipient/amount/hash but not stored chain/confirmations/block/time or correspondence with durable card.funded events. It now checks original chain0x1917, exact confirmation policy, valid block number/hash/time within the funding intent; requires exactly one funded event with the same amount and complete saved receipt. Duplicate event IDs and unmatched funded event totals are inconsistent. No RPC is contacted by this read-only report: chainReverified remainsfalse.

Adds LOCAL_CARD_OUTBOX totals/pending/transportAcknowledged/contentDigest/externalAcceptanceVerified=false. SHA256 is deterministic over original event content, excludes mutable attempts/delivered bookkeeping. Transport acknowledgement does not prove Data Fabric/Billing receiver acceptance: dataFabricReconciled remainsfalse. Snapshot is private account:read, owner-isolated and no-store through the existing HTTP wrapper; no secrets or new account identifiers emitted.

New actual encrypted SQLite tests3/3: failed sends/retry/reopen preserve digest and external-false gates; altered chain/confirmations/block produce inconsistency; altered funding amount/duplicate events are caught despite unchanged balance. Explicit software approvals/Core receipts only. No actual wallet/card/funding is proven by these tests. Dedicated temp fixture state preserved; existing user data untouched.

Whole backend141/141 (zero fail/skip), server compiler-only typecheck pass. Exact backend bundle284849B and SHA recorded in funding-event-415b54bdc-backend-build-20261004.json. Bundle not executed as a protected runtime or installed. Earlier frontend/Web/native results remain source0fd, not relabeled for this source.

Fresh anonymous canonical HTTP readback: frontend runtime identity still66126513738ecbd77a372d2ab7f5ac34076c2208; /api/card/v1/version still e95fcf443228d0db97c139dfa5e8ad6fbb7aa675, both200. Exact response bytes/SHA/headers/request IDs preserved in public-source-reconciliation-readback-20261004.json. This candidate is not deployed. A latest task read contained Media/Cloud work, not a new accepted Card captured-current/role/actor/Host input.

Full Testnet public account approval, registration/private acceptance, real YNXT tx/receipt/Card credit, external Data Fabric delivery, revoke and private-degradation/Standard Wallet E2E remain incomplete. No formal Host/Wallet/SDK/global registry/Website mutation. PSv2/migratedV2/real issuance/PAN/CVV/fiat/real merchant clearing/productionRealPayments false. No YNX_CARD_TESTNET_PRODUCT_READY claim.
