# Feature completion evidence

Evidence is accepted only when it binds to an exact source commit, command or CI run, artifact hash and environment. Current proven states are recorded in `product-release.json` and indexed by `EVIDENCE_INDEX.md`.

## Proven locally

- Canonical Wallet/Auth lifecycle: 30 original SDK tests plus 17 Signed Intent, Smart Account, mandate, capital and Credential tests.
- Wallet native application: 23 unit/integration tests, TypeScript check and product gate.
- Android API 36 installed/cold-launch evidence and iOS Simulator CI build/install/cold-launch/deep-link rejection evidence.
- Hosted test-signed Android APK and unsigned iOS Simulator archive with SHA-256 and byte counts.

## Not yet proven

Central integration, staging/public product deployment, deployed Bundler/Paymaster, sponsored receipt, Wallet→Pay/Quant/DEX live Gateway flows, passkey/Guardian installed flows, capital test positions, explorer proof for Smart Account, production signing and store release remain false. Test code, screenshots from an older identity tuple, or a public chain RPC do not satisfy these states.
