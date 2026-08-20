# YNX Card Testnet Product Requirement Audit

Checkpoint: `337c10541603f00ca5e13bccb97aeb76371f0b3d` plus this pending Card-only
evidence update. Product status is `YNX TESTNET CARD PAYMENT SIMULATION`.

| Requirement | Card-owned evidence | Status |
| --- | --- | --- |
| Standard EVM wallet and `0x1917` switching | `src/wallet.ts`, `src/wallet.test.ts` | Implemented and unit-tested |
| Exact YNXT transaction flow | Intent-bound wallet transaction, receipt/amount/recipient/confirmation checks in `src/wallet.ts` | Implemented, blocked from live execution |
| Real top-up and Card credit | `evidence/testnet-topup-chain-integration-blocker.md` | Blocked externally: intent route, recipient, funded wallet, independent credit and Explorer proof absent |
| Card account and YNXT ledger | `src/processor.ts`, `src/processor.test.ts` | Local Testnet simulation implemented and tested |
| Authorization, partial capture, reversal, refund | `src/processor.ts`, `src/processor.test.ts` | Local Testnet simulation implemented and tested |
| Controls and risk | Freeze, limits, merchant/MCC/country policy, velocity, insufficient balance in `src/processor.ts` | Local Testnet simulation implemented and tested |
| Idempotency, audit, recovery | Processor idempotency/audit plus `src/simulation.ts` persistence/recovery tests | Implemented and unit-tested |
| Data Fabric event contract | `src/dataFabric.ts`, `src/dataFabric.test.ts` maps Card lifecycle events and maintains a replay-safe outbox | Card mapping implemented; central transport acceptance unverified |
| No PAN/CVV/fiat/real-payment claims | `src/api.ts`, `src/api.test.ts`, `CARD_COMPLIANCE_BOUNDARY.md`, Testnet labels in `App.tsx` | Implemented and unit-tested |
| Future regulated adapter readiness | `CARD_PROCESSOR_ADAPTER_CONTRACT.md`, `CARD_NETWORK_READINESS.md` | Contract documented; external commercial/compliance work required |
| Native/assets evidence | `assets/artwork-manifest.json`, `evidence/android/cold-launch.png` | Local inventory only; no hosted download or public release |

## Release decision

`productionRealPayments=false`, `integratedCentral=false`, `testnetVerified=false`,
`deployedPublic=false`, and `releasePublished=false` remain mandatory. The
first candidate for any public Testnet claim needs direct evidence of the
actual `6423 / 0x1917` YNXT transaction, receipt, confirmations, independent
Card ledger credit, duplicate transaction handling, and the matching Data
Fabric delivery acknowledgement.
