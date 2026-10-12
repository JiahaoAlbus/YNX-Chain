# Full workbench admission composition

## Consumer source now provided

`services/codeoss-service/src/admission.mjs` exports `createDeveloperCoreAdmission({driver, executionDomain, architecture})`. It composes an already admitted driver; it neither creates an executor nor installs operator configuration. The protected module loaded by `configuration.mjs` remains the sole production entry. Gateway already passes its result into the durable broker, canonical SSO and HTTP/WS proxy. No new authority, route or session database is added.

The composition requires the exact pinned upstream version/commit/archive digest for the supplied architecture. The observed Linux x86_64 host requires `architecture: 'linux-x64'`, OpenVSCode1.109.5, commit072586267e68ece9a47aa43f8c108e0dcbf44622 and archive SHA256 b433bf4f0227321a7014d8460d10a8f958adc0f45aa79bd889e84e65e8f88363. The driver still owns artifact/derived manifest verification, quota, isolation and actual process proofs. Passing composition validation is not executor admission.

`executionDomain` is A's reviewed canonical DNS domain outside ynxweb4.com. Every session has exactly `https://<sessionUUID>.<executionDomain>/`; ports, credentials, path/query/hash, uppercase/trailing-dot aliases and arbitrary host suffixes are not accepted. The three callbacks use the same mapping, reconstructed without volatile registration after restart. Mapping a valid UUID does not admit a session: `codeossService.authorizeConnection` rechecks the existing SQLite session and canonical owner/account/generation/project before driver connection or SSO ticket issuance. No client request, project file or extension can select the domain or driver.

The wrapper forwards the broker's exact context and preserves the admitted driver's receiver, project root, upstream and preparation/inspection functions. Changed identity tuples fail before execution. Start must return `{running: true, runtimeId}` for the exact runtime; Stop must return `{stopped: true, runtimeId, identityDigest}`. An uncertain result throws into the existing protected recovery path. Connect requires a socket in private-loopback-without-connection-token mode; an incompatible socket is destroyed. Existing broker filesystem/journal code remains the persistence authority, including binary files, old imports and writer release only after exact Stop and checkpoint.

## Minimal A-owned module contract

A installs a root-owned non-symlink `/etc/ynx-developer/adapters/<approved-name>.mjs` with protected ancestors, then sets the backend's `YNX_CODE_CORE_ADAPTER_MODULE` to that exact path. Its exported factory receives `{stateDir, workspaceStore, runtimeProfileService}` from the existing gateway. The factory constructs its *existing approved* driver with A's protected inputs and returns:

```js
// Imports and approvedDriver construction are selected by A from its admitted
// source/artifacts. These lines describe the call contract, not installed paths.
import { createDeveloperCoreAdmission as compose } from '<approved absolute deployed consumer source>/services/codeoss-service/src/admission.mjs';
export async function createDeveloperCoreAdmission(context) {
  const approvedDriver = await createExistingApprovedDriver(context);
  return compose({ driver: approvedDriver,
    architecture: 'linux-x64', executionDomain: reviewedExecutionDomain });
}
```

The missing concrete inputs are the exact protected module/source digest and approved driver construction, immutable upstream and derived artifact paths/digests, persistent project root and actual quota/isolation proofs, reviewed independent domain with wildcard TLS/DNS and proxy mappings, and source-bound backend deployment. The backend must route `/sso/core-admit` to the existing Developer SSO handler and the remaining execution-origin HTTP/WS traffic to the existing proxy before ordinary product handling. Shared canonical backend keys/configuration are A-owned. Current read-only host evidence only proves the adapter directory is absent; executor existence remains unknown. No rejected network/package-egress/LXD action is resumed by this document.

## Normal browser failure recovery

Browser HTML requests to `/sso/core-open` or `/sso/core-admit` now receive a static product recovery page on failure, with the original HTTP status, no-store/CSP and fixed links to Developer projects (and Wallet sign-in on401). It does not reflect operator errors, tickets or request URLs, perform automatic mutations or release writers. Structured API failure responses remain available to JSON clients. The existing project panel provides Refresh and safe Stop recovery; successful entry still uses the canonical one-use SSO exchange.

## Verification limits

Focused contract tests cover exact routing across composition restarts, invalid configuration, driver receiver/context preservation, uncertain proofs, rejected socket cleanup and browser/API failures. Durable broker integration uses real SQLite and filesystem bytes with a clearly controlled driver: uncertain launch/Stop survives restart, another account is rejected, writer protection remains, binary files survive confirmed Stop/reopen. Existing SSO/consumer/proxy regression tests run with those checks. This verifies consumer wiring and persistence failure semantics; the controlled driver is not an OpenVSCode executor and does not fill the mature editor, native terminal, Git/debug/plugin/language, Wallet, AI, public or capacity acceptance gates. Previous452f3bbc6 installed preview remains a separate package identity.
