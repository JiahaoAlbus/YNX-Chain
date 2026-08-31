# YNX Developer Integration Handoff

## Source checkpoint

- Product: `11-developer`
- Branch: `codex/ynx-code-platform-v1`
- Audited repository checkpoint: `e061a30e801a9075dfea212a854b3d7d578d7e85`
- Runtime source checkpoint: `17ee9ae5bf50677a3316b0838884dd135de80599`
- Published desktop artifact source: `76322af5e8c26a64fb6425c51d96c67d2b3df65f`
- Current browser-evidence source: `f38aa95a9ec7ebff68b4d915f41b20ad8f903769`
- Contract: `release/integration/developer-contract.json`
- Recovery matrix: `apps/developer/docs/RECOVERY_AUDIT_2026-08-13.md`
- Current phase: `FREEZE`

## Delivered in this checkpoint

YNX Developer now includes a real API Studio surface backed by a framework-independent client module. It imports and validates OpenAPI 3.0/3.1 JSON, creates bounded operation previews, requires explicit approval, delegates secured network execution to a host credential broker, inspects bounded responses, simulates provider failures, generates TypeScript clients, and produces adapter manifests.

The Web UI includes reviewed templates for WalletConnect, Bridge, Card, Search, Storage, Mail, Shipping, and Oracle. Templates identify the canonical product owner and explicitly do not claim provider affiliation, credentials, connectivity, settlement, or production activation.

The current checkpoint also localizes API Studio labels, approval semantics, dynamic states and bounded error classes across all 12 supported locales. Arabic applies RTL to the interaction surface while source, JSON and URL fields remain LTR. Bottom-panel navigation exposes the tab keyboard model, and API output is a focusable polite live region. Stable machine error codes remain unchanged for cross-product consumers.

## Security invariants

1. Browser JavaScript never resolves credential values.
2. Only opaque `credential-ref:` identifiers may enter project/UI state.
3. Secured requests require an injected host broker.
4. Requests require preview and explicit approval.
5. Network targets must be HTTPS, except localhost sandboxes.
6. Runtime execution is restricted to reviewed origins.
7. External OpenAPI references are rejected rather than fetched implicitly.
8. Undeclared headers and inline credential headers are rejected.
9. Response bodies are bounded before entering the inspector.
10. Provider failures remain failures; no success response is synthesized.

## Required owner actions

### 02 Wallet/Auth

Accept or reject the exact `ynx-developer-v1` product tuple and Wallet-only deployment provider described in the contract. Do not expose signing material to Developer.

### 14 AI

Accept the Developer POST-body workflow, streaming/cancellation semantics, quota errors, and provider truth boundary.

### 19 Oracle, 21 Bridge, 06 Card, 23 Search, 20 Cloud, 25 Mail, 09 Shop

Review only the template fields owned by the corresponding product. A template is not an activated provider integration.

### 26 Data Fabric

Freeze canonical audit event names, payload schema, retention, redaction, and billing boundaries for API spec validation and sandbox execution.

### 29 Integration

Freeze one version of this contract, resolve any scope/event/error conflicts, and execute the cross-product vectors.

### 30 Security/SRE

Review the host broker implementation boundary, origin policy, response limits, logging/redaction, artifact provenance, and deployment controls.

## Test evidence

- `cd packages/developer-client && npm test` — 22 passed
- `cd apps/developer && npm test` — 21 passed locally; artifact-source Windows run `30417693593` passed 20 before the release-record consistency gate was added
- `cd apps/developer && npm run check` — passed
- `cd apps/developer && npm run accessibility:audit` — 15/15 browser checks and six current-source screenshots passed on Chrome 150; evidence is bound to clean source `f38aa95a9ec7ebff68b4d915f41b20ad8f903769`
- `cd apps/developer && npm run build` — passed
- `cd apps/developer && node --check app.js` — passed
- `cd apps/developer && npm run live-check` — passed
- `cd apps/developer && npm run proxy-check` — passed
- `cd apps/developer && npm run desktop:sandbox-check` — 2 passed
- `make no-placeholder-check` and `make secret-scan` — passed through the verified no-`rg` fallback
- `make static-check` — passed
- `cd apps/developer && bash scripts/package-local-macos.sh` — current-source package built from clean pushed commit `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca`
- `cd apps/developer && bash scripts/verify-local-macos-package.sh` — embedded provenance, extracted resource self-test, strict ad-hoc classification, cold launch, bundled server observation and child cleanup passed

## Truth boundary

`implementedLocal=true` and `testedLocal=true` are supported for runtime commit `8f352d0159eef0ab60fb6411e949cfcf3aafb551`; current-source browser accessibility evidence is supported by clean source `f38aa95a9ec7ebff68b4d915f41b20ad8f903769`. Current-source API Studio `installedLocal=true` is supported on macOS arm64 and Windows x64 by package source `7f976c1e06292360160325b00fa0875e6a2567f6`. The macOS ZIP SHA-256 is `ff9ae3d473f961f38294679a7bdb21c7cc0c905d7791efe9d4b114fc1df903f7`; extracted provenance/self-test/ad-hoc classification/GUI cold start/bundled server/cleanup passed. Windows run `30417693593`, job `90467659180`, ZIP SHA-256 `1efaf486164da71d907a8869e5e749fe46bf0bb1a74625f12ddab1692d07fb29`; 22 client tests, 20 Web tests, compile, provenance, native self-test, Authenticode `NotSigned`, portable extraction, WPF cold start, bundled server and cleanup passed. Both packages are unsigned Testnet Preview artifacts; the current Windows Artifact is transient pending pre-release publication. Central integration, staging/public Web deployment, immutable hosted downloads, production signing and store release remain false.

## Next integration action

Provide a reviewed in-process or sidecar host broker fixture that performs one official provider sandbox request while preserving the credential-reference boundary. Then run the accepted Data Fabric audit vector and public/staging evidence gates before changing release status.
