# YNX API Studio

## Release truth

- Runtime source commit: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- macOS package source commit: `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca`
- Status: implemented and tested locally in the Web IDE; installed and cold-launched in the current-source macOS arm64 unsigned Testnet Preview
- Central credential broker: not integrated
- Public sandbox endpoint: not deployed
- Desktop artifact inclusion: verified for macOS arm64 only; the Windows package remains at historical source commit `c6b4affc03b3255100516c34483096f445c46753`

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

## Localization and accessibility

API Studio labels, approval semantics, local validation states and bounded error classes are available in English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Russian, Arabic and Indonesian. Machine-readable error codes remain visible while the human explanation is localized.

Arabic applies RTL to interactive labels, controls, panel tabs and dialogs. Source code, JSON, response output and URL fields remain LTR. The bottom tool area uses tablist/tab/tabpanel semantics with a roving tab stop and ArrowLeft, ArrowRight, Home and End navigation. API output is a focusable polite live region, and the 390px layout collapses grids and wraps long translated actions.

Changing locale translates an untouched empty state only; it does not replace generated previews, responses, client code, manifests or validation evidence.

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
  - Developer Web: 17 passed
  - Static claim/workflow check: passed
  - Standalone Web build: passed
  - Browser module syntax check: passed
  - Live compile check: passed
  - Same-origin proxy check: passed
  - Placeholder and credential-leak gates: passed through the verified no-`rg` fallback
  - Desktop command sandbox: 2 passed
  - Windows source boundary: passed without claiming a Windows package build

## Remaining gates

1. Freeze the host credential-broker contract with Security/SRE and Integration.
2. Connect one official provider sandbox through the broker without exposing credential values to browser JavaScript.
3. Add request/response audit persistence with Data Fabric ownership accepted.
4. Capture installed-browser keyboard, screen-reader, zoom/dynamic-text and 390px visual evidence for the current source checkpoint.
5. Trigger and verify a current-source Windows build before claiming API Studio is installed on Windows; macOS arm64 current-source installation is already verified as unsigned Testnet Preview.
6. Deploy a public or restricted HTTPS staging surface before changing any deployment state.
