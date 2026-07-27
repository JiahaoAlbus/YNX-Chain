# YNX Bridge Open Questions

These are tracked engineering or external-dependency questions. They are not requests for routine user confirmation.

## Autonomous questions

1. Which existing migration/export primitives provide the safest loss-aware rollback rehearsal for schema v7 without inventing a lossy downgrade path?
2. Which existing repository CI conventions should the Bridge-specific workflow reuse while preserving Bridge ownership and test scope?
3. Which Bridge artifact set is appropriate for a server/API product: platform binaries, container image layout, SDK package, source archive, or a combination?
4. Which stale Bridge evidence records bind historical deployment commits intentionally, and which should be advanced to the current runtime source commit?
5. Which consumer-owner test vectors can be exercised locally before central shared-Testnet acceptance is available?

## External questions

1. Which YNX-supported provider or proof-based route is approved as the first executable Testnet architecture?
2. What are the verified source and destination contract addresses, verification URLs, decimals, symbols, authority model, and supply ceilings?
3. Which secure signer or MPC/HSM path and independent operator set are approved for threshold execution?
4. Which funded Testnet accounts and assets may be used without exposing private credentials in repository or chat?
5. Who owns deployment approval, legal review, support, privacy, security disclosure, and public status URLs?
6. Which central consumer source commits constitute Wallet, Explorer, Monitor, Trust, Pay, Exchange, DEX, and Finance acceptance?

External questions remain blocked inputs. The thread must continue all autonomous CI, artifact, migration, restore, metadata, contract-test, and evidence work before producing the final minimized operator request.
