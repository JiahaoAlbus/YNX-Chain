# Finance final UI source/build pin activation

Independently reviewed behavioral source: `01130b501da5c16fce41c547feabf9b7c10cd3f0`, tree `516650642b4a06555bf85b9b6e07c47e09cd662c`. This checkpoint fixed dynamic Broker review translation and disabled stale review links after private authority failure. It did not authorize a Wallet account, signature, Broker order or public deployment.

The active Finance Wallet verifier now binds the final UI source bytes through:

| Object | Git blob | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `apps/finance/evidence/evm-read-runtime-verifier-candidate-final-ui-01130b50-v4-20260925.json` | `ff67c08d547d8c24ea8c374c53884abfd129c9e3` | 6059 | `9568598e9a098b2cfdf7bf6b133db25a28cc4006079f65d25d2349c052cc4286` |
| `apps/finance/evidence/wallet-verifier-manifest-final-ui-01130b50-v5-20260925.json` | `f993625bfc61bef5e8309d64752e0a62051dc709` | 5430 | `13a8700cbd779a3398648427b9464272afc800e0611725bb79da9b5c8ef551cd` |
| `apps/finance/web/wallet-verifier-manifest.json` | `f993625bfc61bef5e8309d64752e0a62051dc709` | 5430 | `13a8700cbd779a3398648427b9464272afc800e0611725bb79da9b5c8ef551cd` |

The candidate's `INDEPENDENT_REVIEW_REQUIRED_NOT_PINNED_NOT_PUBLIC` field records its pre-activation snapshot status, not the current public status. The active verifier pins its exact hash and path; independent review of source behavior and candidates preceded this change. The 28-file manifest is byte-identical to the versioned candidate. Wallet browser bundle: 181663 bytes, SHA-256 `308714f5873469d528a49ce1df993fa9e3617ecabc60c7edaca7db063316893a`, reproduced twice. EVM browser/authority bundles also rebuilt twice from the accepted Wallet/Auth root. Legacy launcher, unreviewed candidate path, input tampering and coordinated bundle/manifest tampering still fail closed.

Owner tests: `npm --prefix apps/finance test` 127/127; `npm --prefix apps/finance run security` pass (346 text files); `npm --prefix apps/finance run smoke` pass; `go test ./internal/finance/... ./apps/finance/cmd/...` pass; `go vet ./internal/finance/... ./apps/finance/cmd/...` pass; `git diff --check` pass. These are source/local gates only. A separate immutable Linux amd64 artifact, deployment lease, public source binding, installed runtime, real Wallet approval, Product Session, Broker order and testnet transaction require their own direct evidence.
