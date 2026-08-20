# YNX AI Client

YNX AI is an independent Web and React Native client for the permissioned `ynx-ai-gatewayd`. Provider
credentials remain server-side. Provider failure is rendered as failure; this
client contains no fallback answer generator.

## Security and product boundaries

- The Web surface consumes the accepted Standard Wallet SDK directly. It prefers
  an announced YNX Wallet, supports MetaMask as a standard EVM fallback, pins
  YNX Testnet `0x1917`, and keeps that connection available when the private
  first-party Product Session is degraded. Standard Wallet connection does not
  create a Product Session or grant access to conversations.
- Private product sign-in is fail-closed until the canonical Product Session v2
  registry and verifier are deployed for AI. The older Go verifier is available
  only when an operator explicitly sets
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

Open `http://127.0.0.1:6438`. Public provider truth and guest preview are usable
without an account. Guest mode loads no private conversation or account data and
cannot generate. Without the canonical private integration, the
production-default server preserves Standard Wallet state while private AI stays
degraded. For an isolated local fixture only, set
`YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH=1` and use a compatible test signer. Never enable
fixture auth in staging or production.

## Checks

```bash
bash apps/ai/scripts/smoke.sh
```

This runs focused fixture-auth, encryption, persistence, provider-failure,
approval and deletion tests; bundles and validates the Standard Wallet Web
surface; builds the product binary; cold starts it; and checks the embedded UI
and truthful product metadata. `npm run browser:proof` separately verifies
desktop/mobile guest mode and a real EIP-6963/EIP-1193 connection through the
accepted SDK with private service degraded.

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
`UI_DESIGN_AUDIT.md`, `OBSERVABILITY.md`, `SLO_CAPACITY_PLAN.md`,
`MIGRATION_COMPATIBILITY.md`, `UNIT_ECONOMICS.md`, and `RELEASE_NOTES.md`.
The release files distinguish the older public runtime from this newer source
checkpoint. The current source truth is:

- Standard Wallet and guest-preview source are locally implemented and tested;
- no current-source staging/public deployment, installed native build, or hosted download;
- no production signing or store release;
- no Product Session v2 migration or central product integration;
- no provider-backed success evidence, therefore `generationLive=false`.

The historical public Web runtime at `https://assistant.ynxweb4.com/` must not be
used as evidence that this newer source is deployed.
