# Exchange Product Session v2 backend consumer — source/build checkpoint

Source: `583a6d1cdb2fe76c523a6075742e323db3851304`, tree `8056275a95c396137bd45254d32ed25a5cfe0e98`.
Branch: `codex/exchange-financial-flow-20260912`.

## Unmodified shared dependency

Central-authorized `git cherry-pick -x` of `0b3761f903ffd5dee6367e49c613cfd8752d7562` produced separate inherited commit `0f9ade81ef12a32816300c9bd1389abbdab4a0b0`, tree `2f9afe8758a8cdebc918fa3b47df81e91b92631c`. All five files under `internal/productsessionv2` compare byte-exact to their original Git blobs. No shared protocol implementation was edited; Central may deduplicate the dependency commit when integrating.

| Shared path | Original and inherited blob |
| --- | --- |
| internal/productsessionv2/README.md | 4ca54044670bb00fe51e3df07863ad16fc984a02 |
| internal/productsessionv2/client.go | b1d6c9d0e7772751609a46803a0705841f5a7936 |
| internal/productsessionv2/client_test.go | 43e4628670b0d93808f4d2f9c84152ee2dfd868d |
| internal/productsessionv2/testdata/finance-v2.json | a5d695eced8fa4dade5bbe6bc9642194001c8477 |
| internal/productsessionv2/testdata/generate.mjs | 0e90e004f4eeff8ad794462650b6b03d9d2fd32c |

## Product-owned runtime wiring

- Fixed new authority `https://wallet-auth.ynxweb4.com`; registered Exchange Web policy `exchange` / `ynx-exchange-v1` / `com.ynxweb4.exchange`, exact origin `https://exchange.ynxweb4.com`, callback `/wallet-auth/callback`. No caller endpoint, platform, product or callback injection.
- Fresh `X-YNX-Product-Session-Proof-V2` is consumed using shared per-request `/v2/product-sessions/introspect`. Server route chooses scope; no retry or decision cache. Introspection occurs before the durable venue request lock. Expiry is checked again after that lock is acquired.
- Existing v1 proofs keep their existing configured authority. Mixed v1/v2 headers reject; unconfigured/failed v2 never falls back to v1. No legacy session migration or deletion.
- Account reads use only the verified native account. No locally issued token, stored authority session or device/private key is returned in account data. Missing authority is private-service degradation, not standard Wallet disconnection. Public market reads remain usable independently.
- Orders still require a separate exact native-wallet action signature. The P-256 device proof/key is **not** assigned to `WalletPublicKey`, cannot sign a venue order, and does not grant capital execution. Existing cancel/withdraw-review interfaces still require native action-key integration; this checkpoint does not claim those flows usable with v2.
- Existing `PUT /v1/security` and `POST /v1/support` only declare `exchange:read`. V2 rejects them with `EXPLICIT_WRITE_SCOPE_UNAVAILABLE`; no new shared scope is invented and read approval cannot mutate security/support. Their legacy behavior is unchanged.
- Configuration reports `productSessionV2=configured_not_attested`, never connected or approved.

## Local verification

`go test -race -count=1 ./internal/productsessionv2 ./internal/exchangeproduct ./apps/exchange/server`: PASS.
`go vet ./internal/productsessionv2 ./internal/exchangeproduct ./apps/exchange/server`: PASS.
`npm test --prefix apps/exchange`: 39/39 PASS.
`git diff --check`: PASS.

New Exchange tests cover canonical route/body/credential isolation; replay delegated to the authority with one call per request; duplicate/malformed/expired/cross-product/origin/callback proofs; mixed headers; read-to-write denial; native/device signature separation and no disk mutation; private outage with guest access; slow authority without venue lock; 20 concurrent reads split between two accounts; second service startup; queued session expiry; route-policy and missing-v2 fail-closed behavior. Product tests explicitly simulate the remote authority. The unchanged shared package runs its actual SDK-generated vector separately. Neither is real public approval evidence. PostgreSQL multi-instance acceptance remains unexecuted without the isolated database fixture configuration.

## Offline Linux amd64 runtime artifact

`/tmp/ynx-exchange-583a6d1cdb2f-20260912-linux-amd64.tar.gz`: 3,825,870 bytes, SHA-256 `c26bddba9e7f2f36c4105bc6a1262298445ed9797891765976d8cda43e2ce0ff`.
Binary: 8,609,976 bytes, SHA-256 `e5aa971fbd69a59474f8023cfbb8cc07cb4b6e3aa4a548d38b44fba40528c56d`.
Bundle manifest SHA-256 `8d771bb4640e0e24955b55c9416686e3a694795b1886dfba1ca401922a50cf74`; binary plus six Web assets and per-file checksums. Cross-compiled only, not an installed or publicly deployed runtime.

## Next boundary and truth

Consume the separately delivered fixed browser private SDK `9840ef871165eb523c4e7a3d48964dd25f8dee8e` in the next Exchange-only checkpoint. Existing Standard c97 SDK bytes are unchanged. Native order-signing, real approval/callback, browser IndexedDB persistence, public source binding and deployment each need their own direct evidence/authority. No SSH, deployment, live account request, signature or transaction occurred.

`publicVerified=false`, `installedVerified=false`, `accountApproved=false`, `productSessionV2LifecycleVerified=false`, `orderSubmitted=false`, `chainTransactionVerified=false`, `migratedV2=false`. Rollback for this source-only checkpoint is owner-controlled source selection; no public runtime was changed.
