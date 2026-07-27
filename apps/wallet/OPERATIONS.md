# Wallet operations

## Build and verification

Run `npm ci && npm run check` in this directory and `npm test` in `packages/wallet-auth`. The Wallet check includes TypeScript, unit/integration tests, product invariants, a no-external-binary release content/secret gate, the full-goal coverage matrix gate, deterministic SBOM verification and Android/iOS Hermes exports. From the repository root, generate the existing contract fixtures with `npm ci && npm run hardhat:build && npm run contracts:selectors` before `make test`; those generated artifacts are ignored and are not Wallet deliverables.

Run `npm run hardhat:test:wallet` for the local official EntryPoint, account, passkey, session, guardian, counterfactual factory and Paymaster flow. Public deployment uses `npm run hardhat:deploy:wallet-smart-account` only through the secure operator environment. It refuses non-6423 networks, requires an exact source commit and public signer/officer addresses, deploys the Paymaster disabled with zero deposit and emits code hashes; funding, policy enablement and Bundler submission are separate approved operations.

Build Android with SDK 36 and Java 17:

```sh
cd apps/wallet/android
ANDROID_HOME=/path/to/android/sdk ANDROID_SDK_ROOT=/path/to/android/sdk ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell am force-stop com.ynxweb4.wallet
adb shell am start -S -W -n com.ynxweb4.wallet/.MainActivity
```

The checked CI workflow `.github/workflows/wallet-ios.yml` performs dependency installation, tests, bundle export, CocoaPods installation and an unsigned Simulator build on macOS 15. It uploads the Simulator product; production archive/signing is deliberately outside CI until owner-controlled Apple credentials exist.

Generate the pinned deterministic CycloneDX 1.6 runtime SBOM with `npm run sbom:generate`, then prove the clean production npm tree, generator version, component identity, unique references, complete license metadata and byte-for-byte reproducibility with `npm run sbom:check`. The check fails closed on any npm tree error, stale committed graph or missing license metadata; `--ignore-npm-errors` is prohibited.

## Canonical Gateway process checks

Create the state directory with mode `0700`; the host writes the state file as `0600` and refuses broader permissions. Start only on loopback:

```sh
install -d -m 700 /secure/runtime/ynx-wallet-gateway
YNX_WALLET_GATEWAY_STATE_PATH=/secure/runtime/ynx-wallet-gateway/state.json \
YNX_WALLET_GATEWAY_HTTP_ADDR=127.0.0.1 \
YNX_WALLET_GATEWAY_HTTP_PORT=6439 \
node packages/wallet-auth/scripts/ynx-wallet-gatewayd.mjs
```

For a process that the operator classifies as remotely deployed, also provide `YNX_WALLET_GATEWAY_SOURCE_COMMIT` as a full lowercase 40-character SHA, `YNX_WALLET_GATEWAY_RELEASE` and canonical UTC `YNX_WALLET_GATEWAY_BUILD_TIME`; startup fails if any part is missing or malformed. This classification does not itself prove central merge, staging, public reachability or Monitor acceptance.

Probe `GET /health`, `/ready`, `/version` and `/metrics`. Require request/trace IDs on every response and an error ID on rejection. `/ready` must keep runtime and public-deployment readiness separate, `/version` must match the deployed source/release/build time, and metrics must expose only bounded route and public-error labels. Standard output is canonical JSON Lines; reject a logging pipeline that records request bodies, Product Session proofs, authorization headers, custody material, signatures, provider secrets or state paths.

## Runtime checks

- Confirm the header says `YNX TESTNET · ynx_6423-1` and user-facing accounts remain `ynx1...`.
- Confirm balance/activity state is authoritative, or shows an honest network failure and retry.
- Confirm a force-stop restarts locked, a background transition locks, and strong biometrics gate key use.
- Confirm the authorization route rejects malformed or replayed requests before showing approval.
- Confirm central introspection includes exact product, device, account and scopes; revoke session/approval/device/account sessions and re-introspect.
- Confirm Smart Account simulation and sponsorship use the unchanged operation digest and exact EntryPoint/target/selector policy; a provider outage or exhausted budget must show ineligible with zero approved cost.
- Confirm strategy mandate kill/revoke/emergency-exit paths and Credential expiry/status failure before enabling either surface.

## Rollback and incidents

Mobile rollback means distributing a previously verified artifact through the eventual owner-controlled channel. Never downgrade the central registry schema or re-enable a pending product. During suspected key compromise: disable the exact registry entry, revoke the device and approval digest, invalidate all account sessions, preserve audit hashes, then require account recovery/rotation. The Wallet cannot honestly claim online cross-device revocation until the central lifecycle service is merged and deployed.

Engineering-only Android and iOS Simulator downloads are hosted in the immutable GitHub prerelease recorded by `artifact-manifest.json`. Do not label them production-signed or store-released. No public product deployment or update service exists.
