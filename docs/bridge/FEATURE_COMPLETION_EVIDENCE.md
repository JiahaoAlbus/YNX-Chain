# Bridge Feature Completion Evidence

Status date: 2026-07-27. Runtime and public read-only Testnet evidence source commit: `73cd827adb2711589a7f2af2411d4ae12c3add79`; the deployed Provider health observation is verified to refresh every 60 seconds, fail closed on a real egress outage, and automatically recover without a service restart.

## Evidence-backed state

| Capability | implementedLocal | testedLocal | installedLocal | integratedCentral | deployedStaging | deployedPublic |
| --- | --- | --- | --- | --- | --- | --- |
| Persistent transfer coordinator | true | true | false | false | false | false |
| Relayer quorum and replay rejection | true | true | false | false | false | false |
| Persisted relayer signature/quorum/audit revalidation | true | true | false | false | false | false |
| Versioned 19-state lifecycle, failure, retry, refund, recovery, dispute, correction, expiry, pause | true | true | false | false | false | false |
| Domain-separated threshold-relayer proof bundle and explicit proof verification gate | true | true | false | false | false | false |
| Destination confirmation separated from destination asset availability | true | true | false | false | false | false |
| Deterministic route ID, message ID, nonce domain, and changed-replay rejection | true | true | false | false | false | false |
| Append-only source-qualified lifecycle timeline and schema v1-v7 migration | true | true | false | false | false | false |
| Settlement-aware exposure accounting across dispute, availability, refund, and legacy migration | true | true | false | false | false | false |
| Pause/resume, route/provider/user/daily limits, large-transfer delay | true | true | false | false | false | false |
| Public transparency and reconciliation record | true | true | false | false | false | false |
| Exact persisted reconciliation replay and v1-v6 migration into schema v7 | true | true | false | false | false | false |
| Fail-closed route catalog and route execution disclosure | true | true | false | false | false | false |
| Machine-readable fail-closed Provider Registry with incomplete-incident-history marker | true | true | false | false | false | false |
| Digest-bound, expiring, fail-closed Quote Runtime with explicit unavailable provider terms | true | true | false | false | false | false |
| Product Session-bound Wallet Review Runtime through the local App Gateway patch | true | true | false | false | false | false |
| Official Circle CCTP V2 fee adapter, supported-domain Sandbox probe, fail-closed outage detection, and automatic recovery, with YNX route kept unavailable | true | true | false | true | true | true |
| Remote Testnet coordinator and canonical App Gateway upstream, with execution disabled | true | true | false | true | true | false |
| Public TLS read-only health, version, status, routes, providers, assets, transparency, and state-machine surface | true | true | false | true | true | true |
| Fail-closed token allowlist and asset/contract disclosure | true | true | false | false | false | false |
| Trace propagation, metrics, alert rules, and dashboard definition | true | true | false | false | false | false |
| Truthful `/health`, `/version`, state-machine, product status, and readiness boundary | true | true | false | false | false | false |
| Read-only Bridge JavaScript SDK, TypeScript declarations, and dual availability guard | true | true | false | false | false | false |
| Data export, retention hold, deletion-request execution, and identity redaction | true | true | false | false | false | false |
| Service-cessation and user-exit runbook | true | true | false | false | false | false |
| External source submission | false | false | false | false | false | false |
| Destination mint or release execution | false | false | false | false | false | false |
| Official stablecoin transfer route | false | false | false | false | false | false |

`productionSigned`, `downloadHosted`, and `storeReleased` are false because this server component has no signed end-user package or store distribution.

## Direct local evidence

- `go test -race ./internal/bridgegateway ./cmd/ynx-bridged`
- `go test -race ./internal/appgateway ./cmd/ynx-app-gatewayd`
- `make app-gateway-check`
- `make bridge-api-check`
- `make bridge-provider-check`
- `make bridge-integration-check`
- `make bridge-route-adapter-check`
- `make bridge-observability-check`
- `make bridge-sdk-check`
- `make bridge-data-lifecycle-check`
- `make bridge-supply-chain-check`
- `make bridge-capacity-check`
- `make bridge-restore-check`
- `make bridge-evidence-check`
- `go test ./...`
- `make no-placeholder-check`
- `make secret-scan`

The API check launches the compiled daemon and exercises public fail-closed route/asset catalogs, unauthorized rejection, create replay/conflict, persistent restart and semantic state validation, pause/resume rejection, exposure limits, public transparency, an intentionally unbalanced reconciliation, truthful metrics, state file mode, and secret non-disclosure. Provider Registry unit and SDK tests prove deterministic route binding, explicit unavailable credentials/contracts/commercial rights/health, incomplete incident-history coverage, and rejection of readiness overclaims. Focused race tests additionally prove exact reconciliation replay across newer observations and restart, fail-closed migration, and rejection of forged replay/accounting/timestamp, quorum, signature, index, and audit state.

## Missing completion evidence

Remote Testnet installation evidence is recorded in `testnet-deployment-evidence.json`, and independent-node HTTPS proof for the complete public read-only surface is recorded in `public-read-evidence.json`. The coordinator and canonical App Gateway upstream are active. The deployed Circle CCTP V2 Sandbox probe reached supported Ethereum Sepolia domain 0 to Base Sepolia domain 6 and is publicly observable. A real service-account egress outage changed the public Provider state to unavailable and the available Provider count to zero; removing the outage recovered the same running process automatically. Agreement approval, route availability, quote execution, external submission, and every asset-execution boundary remained false throughout. This is supported external-route Provider API evidence, not YNX route support. No YNX source-chain transaction hash, destination transaction hash, verified YNX Bridge contract, issuer attestation for YNX, independent security review, funded YNX route, or public Testnet deposit/withdrawal exists. Those states remain false.
