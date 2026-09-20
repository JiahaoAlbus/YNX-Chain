# Weekly v3 release integration

Owner: NETWORK, isolated branch `codex/weekly-v3-release-integration-20260920`.
Baseline: main `460beb36bc7af7036524caf6d1bb81a75909d279`
(Finance PR153 + Wallet PR152). No Finance or Wallet implementation is changed.

## Changes

- Native artifact publication metadata now records the actual GitHub prerelease,
  with target merge SHA separate from build source SHA.
- Wallet Web selects the exact publicly verified Android 1.0.16 APK. No
  unverified downloads-origin mirror is invented. A narrowly pinned release
  exception binds URL, fallback, byte size, digest and signing disclosure;
  all other packages retain their existing content-addressed origins.
- The integration bridge awaits Finance's asynchronous begin/parseReturn.
  Approval refusal is reported before Wallet signing instead of passing an
  undefined route to the controller.
- A new regression loads the unchanged Finance browser bundle and proves
  PENDING private authority and expired authority reject before storage/network
  writes. It does not inject a VERIFIED authority or bypass the release pin.

## Verified scopes

- 45/45 integration fixture/guard tests, including 3 new authority regressions
  and the real Chromium FormData guard; zero skips.
- Wallet Web 366/366 tests and built platform-download gate.
- `go test -race ./internal/finance/... ./apps/finance/cmd/... ./internal/faucet/...`.
- Read-only public RPC/Faucet 8/8 health samples in the committed evidence;
  this is one local vantage, not global or continuous availability.
- Full public APK download: 116631255 bytes and SHA-256
  `89a842dc8641206a9154a6e41fd1c9e3cbb4b6cca2cea455ed5b7fc674b558c0`.
  AAB is metadata-verified only. No fresh installed-app acceptance.

## Explicitly blocked scope

The actual bundled endpoint authority still has
`walletGateway=PENDING` and `products.finance=PENDING`. Therefore the
unmodified browser-to-Wallet approval flow must remain blocked. The full
integration runner must not be reported as passing. Provider/HTTP/store
unit contracts passing do not supersede this gate.

Official Sandbox credentials, account/data rights and a separate low-frequency
test-write approval remain external inputs. Real WalletConnect Relay requires
its own configured project and installed acceptance. Mainnet/live remain off.
No credential, service configuration, chain state, Faucet admission or public
deployment was changed here.

Website selection is prepared separately in repository YNX-Chain-website,
branch `codex/weekly-v3-wallet-1016-entry-20260920`; its deploy decision is
independent of GitHub artifact publication and this source checkpoint.

## Recovery and verification

Revert only this scoped change through a fresh reviewed branch if necessary;
do not reset a shared checkout or delete published artifacts. Previous 1.0.15
GitHub assets and website historical release evidence remain intact.

```sh
WEEKLY_FINANCE_ROOT="$PWD" node --test scripts/verify/weekly-v3/*.test.mjs
npm --prefix apps/wallet-web test
node apps/wallet-web/scripts/artifact-platform-download-gate.mjs
go test -race ./internal/finance/... ./apps/finance/cmd/... ./internal/faucet/...
```

Status for this change: implemented=true; contractTested=true;
officialSandboxVerified=false; publicDeployed=false; publicVerified=false
for the new website/Wallet Web selection; productionApproved=false.
The separate immutable APK publication and sampled RPC health evidence do not
turn those product acceptance flags true.
