# AI039 consumer with shared1a8 Wallet transport

This source update preserves AI039 consumer/backend/data behavior and replaces
only its current Wallet vendor reference. The prior a32 asset remains immutable.
The new asset is exactly the separately reviewed derived candidate, not a
relabelled original039 binary:

- AI build entry: `039b1b09465c99ccb1b02d57cee3a0fd875bda37`
- Shared source: `1a8daf15c92602283c37c975f338fb16b596bb23`
- Asset: `apps/ai/web/vendor/wallet-connection-ai039-shared1a8.mjs`
- 562596 bytes; SHA256 `9b55c017830bbfdf67bf4715a00f15f172d596b0a2b22468e8ce4de32ffa1865`
- Full graph: 784 inputs, including 25 immutable Git source blobs; two exact
  shared-source dependency lock hashes are also recorded.

Rebuild using the installed locked dependencies, without editing shared source:

```
YNX_AI_DEPENDENCY_ROOT=<exact locked checkout> node apps/ai/tests/build-wallet-consumer.mjs
node --test apps/ai/tests/wallet-derived-source.test.mjs
go test ./apps/ai -run TestEmbeddedDerivedWalletMatchesReviewedSource -count=1
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o <new candidate>/ynx-ai-client ./apps/ai
```

The generator archives exact shared Git source and exact AI entry, verifies all
source inputs against their Git blobs, checks locked dependency versions/locks,
and requires the reviewed derived output digest. Never copy this vendor over the
old immutable filename or reuse an old Go binary: `apps/ai/main.go` embeds assets.

**Known integration gap retained:** the original strict
`ai-connection-contract.test.mjs` AI identity-only SSO registration assertion
fails against shared1a8 because that shared central registry omits AI. It has not
been skipped or relaxed. The sole shared/Auth owner must supply an exact reviewed
registration successor, regenerate a newly named vendor with a new source/hash
binding, and rerun this assertion before claiming AI SSO readiness.

Other AI consumer tests pass. Embedded asset/hash verification does not prove
public Wallet approval, provider generation, private AI session, model service,
or deployment readiness. The publisher must preserve current state/key paths,
rebuild the Go embed, integrate the shared registration successor and verify
normal installed/public connection, separate identity/private authorization,
and original service return flow. This work performs no host/deploy operation.
