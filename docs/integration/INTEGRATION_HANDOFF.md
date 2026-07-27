# YNX Developer Integration Handoff

## Source checkpoint

- Product: `11-developer`
- Branch: `codex/final-developer`
- Runtime source commit: `3cc6bd3e9de6f88c7637ba1400923ff6cd6ee58d`
- Contract: `release/integration/developer-contract.json`
- Current phase: `FREEZE`

## Delivered in this checkpoint

YNX Developer now includes a real API Studio surface backed by a framework-independent client module. It imports and validates OpenAPI 3.0/3.1 JSON, creates bounded operation previews, requires explicit approval, delegates secured network execution to a host credential broker, inspects bounded responses, simulates provider failures, generates TypeScript clients, and produces adapter manifests.

The Web UI includes reviewed templates for WalletConnect, Bridge, Card, Search, Storage, Mail, Shipping, and Oracle. Templates identify the canonical product owner and explicitly do not claim provider affiliation, credentials, connectivity, settlement, or production activation.

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
- `cd apps/developer && npm test` — 16 passed
- `cd apps/developer && npm run check` — passed
- `cd apps/developer && npm run build` — passed
- `cd apps/developer && node --check app.js` — passed

## Truth boundary

`implementedLocal=true` and `testedLocal=true` are supported for the current source checkpoint. Central integration, staging/public deployment, hosted downloads, production signing, and store release remain false. Existing macOS and Windows package evidence was produced from commit `c6b4affc03b3255100516c34483096f445c46753`; API Studio is not claimed installed in those artifacts.

## Next integration action

Provide a reviewed in-process or sidecar host broker fixture that performs one official provider sandbox request while preserving the credential-reference boundary. Then run the accepted Data Fabric audit vector and public/staging evidence gates before changing release status.
