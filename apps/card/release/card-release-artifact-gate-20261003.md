# Card source-bound release artifact gate

Ordinary owned implementation under human full development discretion. This gate is not a lease or permission to publish. Formal build/Host remains A-only.

Changes: build-web checks package/app version agreement, records appVersion and releaseChannel in runtime-identity.json. Channel defaults to qa; only A's explicit YNX_CARD_RELEASE_CHANNEL=testnet-release produces a formal candidate identity. This does not visibly mark a running QA window; A must still give QA windows a visible QA/source label and keep them off the canonical alias.

Before formal publication A runs:

```sh
node apps/card/scripts/verify-release-artifacts.mjs <isolated-static-root> <independently-admitted-receipt.json>
```

Receipt schema ynx.card.release-artifacts.v1 requires sourceCommit/sourceTree exact40hex, appVersion, canonicalURL https://card.ynxweb4.com/ and files[{path,bytes,sha256}]. Receipt must be frozen from independent admission, not generated from the candidate being verified. Gate verifies exact complete inventory, no symlinks/path escapes/duplicates/extras, mandatory product shell/runtime/PWA assets, local script binding, English product shell, exact source/tree/version/channel and Testnet/non-real-payment identity. It returns ARTIFACT_PARITY_ONLY, publicationAuthorized=false and publicBusinessVerified=false. Hash parity is not application capability or original-user journey acceptance; those still require A's integrated-source review and actual runtime recovery/Guest/application/Wallet/ledger validation.

7/7 isolated node tests passed: exact parity/not publication; old source/version-only change; QA rejection; drift/extras; missing PWA; escape/duplicate; real-payment rejection. Synthetic test artifacts are explicitly QA, no runtime or account evidence. No existing source tests rerun unnecessarily; previous442/typechecks remain evidence for their prior source, not a formal build of this follow-up. No build/deployment/account/sign/tx or protected dist-web mutation performed. No stored account/keys/journals/unknown requests changed.

Remaining release intake: A binds the integrated artifact and installed baseline, confirms version/About/logo consistency and visible QA labeling, then validates formal user journeys under current authority. This script cannot prove a Card backend receipt, ACTIVE, funding, public approval or migration.
