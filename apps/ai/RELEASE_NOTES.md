# YNX AI 1.0.0 Testnet Preview

This preview publishes the independent AI Web product at `https://assistant.ynxweb4.com/`. It does not claim central Wallet acceptance, hosted native downloads, production signing, store release, or successful provider generation.

## Product changes

- Wallet-bound product sessions, encrypted-at-rest conversation and attachment storage, retention controls, export, delete-all, revocation, and linked local audit records.
- Conversation create/select/rename/archive/delete/search/copy/export/retry/branch/continue flows.
- POST-body generation requests, SSE metadata/token/done/error parsing, cancellation, provider/model/estimated-cost state, and truthful unavailable/429 outcomes with no canned substitute.
- Explicit permission and tool/action preview with scope, target, exact payload, risk, evidence, provider, approve/reject, `approved_not_executed`, Wallet-required boundary, and audit.
- React Native Android/iOS project with 12 locales, Arabic RTL logic, platform deep link, encrypted SecureStore session persistence, bounded attachments, and accessibility labels.
- Responsive Web UI with reduced-motion and light/dark rendering. Production auth fails closed until the canonical Wallet integration is deployed.

## Central integration request

`apps/ai/integration/` contains the exact `ynx-ai-v1` schema-v2 registry entry, AI request digest vector, Wallet registry patch, POST-body Gateway patch, and a machine-readable integration state. These are merge inputs only.

## Release truth

- `generationLive=false`: no provider-backed successful staging output exists.
- Android APK is test-signed, not production-signed, and not hosted.
- iOS cannot be built locally without Xcode; the checked-in macOS workflow performs a real Simulator build/install/launch/deep-link/hash sequence.
- The public Web surface, liveness, readiness and redacted provider-status endpoints are deployed over HTTPS.
- The deployed Gateway accepts the strict POST-body SSE contract. The bounded provider run returned HTTP 429 and no substitute answer; therefore `generationLive=false` remains authoritative.
- Public 25-worker checks returned 100/100 HTTP 200 for health, redacted status and the Web shell.
