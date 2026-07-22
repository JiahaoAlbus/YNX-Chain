# Feature completion evidence

Evidence is accepted only when it binds to an exact source commit, command or CI run, artifact hash and environment. Current proven states are recorded in `product-release.json` and indexed by `EVIDENCE_INDEX.md`.

## Proven locally

- Canonical Wallet/Auth lifecycle: 30 original SDK tests plus 24 Gateway adapter, Signed Intent, Smart Account, mandate, capital and Credential tests.
- Wallet native application: 28 unit/integration tests, TypeScript check and product gate.
- Android API 36 installed/cold-launch evidence and iOS Simulator CI build/install/cold-launch/deep-link rejection evidence.
- Hosted test-signed Android APK and unsigned iOS Simulator archive with SHA-256 and byte counts.
- Official eth-infinitism EntryPoint v0.8 plus the YNX Smart Account compile locally with solc 0.8.28. A real local `handleOps` flow covers owner, UV-required WebAuthn, bounded session key, policy rejection and delayed guardian recovery. This is local EDR evidence only.
- The local Paymaster flow sponsors zero-balance accounts through EntryPoint for first-action, merchant, developer and product modes. EIP-712 tamper, authorization replay, second first-action, unapproved target, disabled product and Risk Officer re-enable attempts fail closed; product/subject budget invariants and postOp observations are asserted.
- The Wallet Smart Account & Capital control surface consumes only a strict runtime evidence snapshot. It never creates a position or success claim, fails closed on malformed/future/duplicate evidence, marks capital evidence stale after 24 hours, requires five-minute-fresh EntryPoint and Bundler evidence for readiness, preserves legacy `bridge-route`, and covers all 15 required current capital product types. Property, fuzz, fault and 5,000-snapshot soak/benchmark tests pass; the 2026-07-22 local run completed in 728.28 ms.
- The current Smart Account & Capital sheet was installed through a debug native shell on an Android 16/API 36 emulator, cold-launched, unlocked with an enrolled strong simulated fingerprint and accessibility-inspected. The screen visibly fails closed without runtime evidence and shows all required missing product classes plus non-guarantee/AI boundaries. Current JavaScript was delivered by local Metro, so this is installed interaction evidence, not a standalone or hosted APK claim.
- Wallet Android Release no longer inherits debug signing. The Expo config plugin preserves this after prebuild, partial external credential configuration fails during Gradle evaluation, and debug validation uses only a debug-class user keystore. Owner Release credentials remain external and were not requested in chat.

## Not yet proven

Central integration, staging/public product deployment, deployed Bundler/Paymaster, public sponsored receipt, Wallet→Pay/Quant/DEX live Gateway flows, installed-device passkey/Guardian flows, capital test positions, explorer proof for Smart Account, production signing and store release remain false. Local EDR contract execution, test code, screenshots from an older identity tuple, or a public chain RPC do not satisfy these states.

The public EVM endpoint returned chainId 6423 and block 442,153 after bounded retries, but returned JSON-RPC `-32601` for `eth_getCode`. This directly contradicts public EntryPoint/code-verification readiness. The required Chain Core runtime and RPC acceptance surface is recorded in `packages/wallet-auth/integration/chain-erc4337-requirements.json`; no deployment state is raised.

The canonical Gateway adapter, manifest, state schema and cross-language proof vector are implemented and tested but have not been merged into or deployed by `ynx-app-gatewayd`; `integratedCentral` therefore remains false.
