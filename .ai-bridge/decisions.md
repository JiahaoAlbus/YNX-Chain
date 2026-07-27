# YNX Bridge Decisions

## 2026-07-27 — Preserve truthful deployment classes

The read-only Bridge surface may be described as publicly reachable, while coordinator installation remains staging and asset execution remains disabled. A public health or route response does not prove a public executable bridge.

## 2026-07-27 — Keep Circle connectivity separate from YNX route support

A successful generic Circle CCTP V2 fee API probe establishes provider API connectivity only. It does not establish YNX network support, route approval, contract verification, Wallet source submission, destination mint/release, or asset availability.

## 2026-07-27 — Fail closed on malformed startup configuration

Non-empty malformed Bridge integer and duration environment values must stop startup. Silent fallback is prohibited because it can weaken thresholds, rate limits, retention, or quote-expiry assumptions without operator awareness.

## 2026-07-27 — Keep external asset execution disabled

No source submission or destination execution may be enabled until all of the following are directly evidenced: approved route architecture, verified contracts, secure threshold signer path, funded Testnet accounts/assets, central acceptance, deployment authority, and security/compliance gates.

## 2026-07-27 — Infrastructure owns semantics, consumers own end-user UI

YNX Bridge remains an independent server/API/SDK product. Wallet, Pay, Exchange, DEX, Finance, Explorer, Monitor, and Trust own their native user interfaces and accessibility implementation, while Bridge owns canonical lifecycle, risk, error, source, freshness, and availability semantics.

## 2026-07-27 — Current product status remains ACTIVE

Local runtime quality, central Gateway integration, staging installation, and public read-only evidence are checkpoints. Missing real deposit/withdrawal receipts, Bridge-specific CI/release artifacts, rollback evidence, consumer acceptance, and external execution prerequisites prevent completion.
