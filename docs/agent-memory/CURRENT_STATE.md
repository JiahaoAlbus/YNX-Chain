# YNX Pay current state

- Product: `04` / `YNX Pay`
- Branch: `codex/final-pay`
- Implementation source: `6cbac9f4654b5715d32f1e561819e593c868a6f1`
- Evidence checkpoint: `8968cd27d6054d75286702401ec8484e7efe050a`
- Exact-source CI: run `30575350364`, all three jobs successful
- Phase: `INTEGRATE`
- Goal status: `active`

The full Linux test job is green. Xcode 26.2 produced unsigned YNX Pay and YNX Card Simulator applications from the exact source SHA. Pay passed bundle-ID validation, Simulator installation, cold launch, app-container lookup and `ynxpay://` scheme resolution.

The Pay artifact is authenticated GitHub Actions evidence that expires on 2026-08-29. It is not a public immutable download, production-signed device build or store release. Android install/cold-launch evidence remains absent.

Chain Core, Wallet/Auth, Oracle, Bridge, Data Fabric and Security/SRE have central acceptance receipts. Pay itself is not yet centrally accepted, deployed to the shared Testnet or source-bound to the public runtime.

Public truth is unchanged: `pay.ynxweb4.com/health` reports old build `98a18815d4ee`; `/pay` serves the generic site rather than a source-bound Pay product page. Therefore public, hosted-download, production-signing and store states remain false.

Next: validate and freeze the final evidence head on the protected owner branch, then integrate it through `29-integration`.
