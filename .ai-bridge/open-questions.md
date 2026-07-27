# YNX Pay open questions and blockers

These are integration/operator inputs, not questions for ordinary Pay implementation decisions.

- Which exact Wallet/Auth and App Gateway source commit will `29-integration` freeze for `ynx-pay-v1`?
- Which public Testnet deployment target and route authority will expose the Pay product service?
- Which approved paymaster, stablecoin issuer/reserve contract and Bridge provider are available on YNX Testnet, if any?
- Which canonical Data Fabric event version and Economics fee-source version should Pay emit?
- Which Trust case schema/version is accepted for dispute and appeal linkage?
- Which Android/iOS signing and store accounts will be used after test artifacts are verified?
- Which approved encrypted backup retention target, replication policy and production-volume RTO/RPO acceptance environment will `30-security-sre-release` provide?
- GitHub Actions, Release and artifact API reads repeatedly failed with TLS handshake timeouts on 2026-07-27; remote evidence must be retried without changing local release truth.

Until answered with direct owner evidence, the corresponding coverage items remain externalBlocked rather than complete.
