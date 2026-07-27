# YNX API Studio

## Release truth

- Source commit: `3cc6bd3e9de6f88c7637ba1400923ff6cd6ee58d`
- Status: implemented and tested locally in the Web IDE source checkpoint
- Central credential broker: not integrated
- Public sandbox endpoint: not deployed
- Desktop artifact inclusion: not claimed; existing macOS and Windows package evidence predates this checkpoint

## Implemented workflow

`OpenAPI JSON → validate → select operation → enter declared parameters → attach credential references → preview → approve → host-brokered sandbox request → inspect response`

The same surface can generate a TypeScript transport client, an adapter manifest, and deterministic negative scenarios for rate limiting, timeout, provider unavailability, and network failure.

## Validation boundary

API Studio accepts OpenAPI 3.0.x or 3.1.x JSON up to 512 KiB. It rejects:

- external references;
- duplicate or invalid operation identifiers;
- missing responses;
- duplicate parameters;
- unsupported parameter locations;
- non-JSON request bodies;
- unsupported security schemes;
- embedded URL credentials;
- undeclared headers;
- inline credentials;
- non-HTTPS targets other than localhost;
- targets outside the reviewed origin allowlist.

YAML is not silently parsed. It must be converted to reviewed JSON so the exact imported document can be diffed and audited.

## Credential boundary

The browser stores only opaque `credential-ref:` identifiers. It never resolves credential values. A secured request can execute only through an injected host broker implementing the reviewed `send` boundary. Without that broker, the UI returns `credential_broker_unavailable` and remains fail closed.

## Connector templates

Reviewed, non-affiliation templates are provided for:

- WalletConnect — owner `02-wallet-auth`
- Bridge — owner `21-bridge`
- Card — owner `06-card`
- Search — owner `23-search`
- Storage — owner `20-cloud`
- Mail — owner `25-mail`
- Shipping — owner `09-shop`
- Oracle — owner `19-oracle-market-data`

These are adapter contracts, not claims of provider credentials, connectivity, settlement, production activation, or partnership.

## Evidence

- Core: `packages/developer-client/src/api-studio.js`
- Core tests: `packages/developer-client/test/api-studio.test.js`
- Web surface: `apps/developer/index.html`, `apps/developer/app.js`, `apps/developer/styles.css`
- UI boundary tests: `apps/developer/test/api-studio-ui.test.js`
- Test results:
  - Developer client: 22 passed
  - Developer Web: 16 passed
  - Static claim/workflow check: passed
  - Standalone Web build: passed
  - Browser module syntax check: passed

## Remaining gates

1. Freeze the host credential-broker contract with Security/SRE and Integration.
2. Connect one official provider sandbox through the broker without exposing credential values to browser JavaScript.
3. Add request/response audit persistence with Data Fabric ownership accepted.
4. Run Browser interaction and accessibility evidence for the new panel.
5. Rebuild and verify current macOS and Windows artifacts before claiming API Studio is installed in desktop packages.
6. Deploy a public or restricted HTTPS staging surface before changing any deployment state.
