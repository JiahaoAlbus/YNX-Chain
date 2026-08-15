# YNX Wallet Android fixed-release download gate

Website owners must not publish an Android download for the account-read fix until the artifact is bound to source commit `018cf5abfc2ef80c88ed8897265718ed85176a0e`.

The required fixed behavior preserves the native REST API for activity and broadcast. Only an exact REST `account not found` response may be resolved through the canonical `https://rpc.ynxweb4.com/evm` JSON-RPC endpoint after verifying chain ID `0x1917` and obtaining the selected address's balance and nonce. A transport timeout, malformed response, wrong chain, unrelated 404 or REST 5xx remains an unavailable/error state; Wallet must not manufacture a zero balance.

Current exact-source CI is [run 31867652567](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/31867652567) and is still in progress at this handoff. Its APK hash, bytes, signer and direct-install evidence are not yet available.

When CI completes, accept a candidate only if its generated manifest names this exact source commit and reports:

- package `com.ynxweb4.wallet`, Android API 24 minimum, API 36 target, `arm64-v8a`;
- `disposable-qa-release-key` with v2 APK signature and its actual certificate SHA-256;
- actual APK bytes and SHA-256; and
- direct install plus first and second cold-launch evidence for that same APK.

The candidate must be described truthfully as a disposable QA build. It is not production-signed, Play Store released or ready to be claimed as public/official-hosted until the official website serves those exact verified bytes and a public backread succeeds. Never substitute an older Wallet APK for this fix.

Machine-readable gate: `release/integration/wallet-android-fixed-release-download-gate-2026-08-15.json`.
