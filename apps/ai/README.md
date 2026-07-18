# YNX AI Client

YNX AI is an independent Web and React Native client for the permissioned `ynx-ai-gatewayd`. Provider
credentials remain server-side. Provider failure is rendered as failure; this
client contains no fallback answer generator.

## Security and product boundaries

- Production sign-in is fail-closed until the canonical `@ynx-chain/wallet-auth`
  verifier and exact AI registry entry are merged and deployed. The older Go
  verifier is available only when an operator explicitly sets
  `YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH=1`; it is for local tests and is not a
  production auth authority.
- Conversation bodies are encrypted with AES-256-GCM. The state file contains
  metadata, authenticated ciphertext, token hashes, permission/action records,
  appeals, deletion state, and a linked audit chain; it never stores Wallet or
  provider private material.
- Tool, action, and chain-action proposals stop at explicit review. Approval is
  recorded as `approved_not_executed`. Chain actions still require a separate
  YNX Wallet transaction review and signature.
- Provider quota and actual token usage are currently not returned by the
  Gateway. The client says `quota unknown` and labels token, resource, and money
  values as estimates. Money remains unknown unless operator-supplied provider
  rate metadata is configured.

## Run locally

Copy the values from `.env.example` into your secret runtime environment; do not
commit them. Then:

```bash
go run ./apps/ai
```

Open `http://127.0.0.1:6438`. Without the canonical central integration, the
production-default server shows the Wallet boundary and refuses sign-in. For an
isolated local fixture only, set `YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH=1` and use a
compatible test signer. Never enable fixture auth in staging or production.

## Checks

```bash
bash apps/ai/scripts/smoke.sh
```

This runs focused fixture-auth, encryption, persistence, provider-failure, approval and
deletion tests; validates browser JavaScript; builds the product binary; cold
starts it; and checks the embedded Web surface and product metadata.

The product client is `ynx-ai-v1`, bundle/package identifier is
`com.ynxweb4.ai`, and the exact Wallet callback is
`ynxai://wallet-auth/callback`. Merge inputs for the central owners are under
`apps/ai/integration/`.

## Native product

```bash
cd apps/ai/mobile
corepack enable
pnpm install --frozen-lockfile
pnpm run check
```

Android release preview:

```bash
cd android
ANDROID_HOME=/absolute/android-sdk ANDROID_SDK_ROOT=/absolute/android-sdk \
  NODE_ENV=production ./gradlew :app:assembleRelease
```

The resulting APK is test-signed unless an owner-controlled signing configuration
is supplied. `.github/workflows/ynx-ai-mobile.yml` contains runnable Android and
iOS Simulator jobs. The iOS job performs CocoaPods install, Xcode release build,
Simulator install, cold launch, restart, exact callback deep link, zip and SHA-256.

## Release status

Read `product-release.json`, `artifact-manifest.json`, `evidence-index.json`,
`UI_DESIGN_AUDIT.md`, and `RELEASE_NOTES.md`. The current release truth is:

- no staging/public deployment or hosted download;
- no production signing or store release;
- no central Wallet/Gateway integration;
- no provider-backed success evidence, therefore `generationLive=false`.
