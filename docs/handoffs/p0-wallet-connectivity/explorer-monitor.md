# Explorer and Monitor Handoff

## Candidate checkpoint

- Branch and candidate commit: `codex/p0-explorer-monitor-20260820` at
  `7ef419e1191b8ded301e0f9941a698d673d55b1a`.
- Candidate PR: [#107](https://github.com/JiahaoAlbus/YNX-Chain/pull/107),
  opened as a draft against `codex/p0-wallet-connectivity-control-plane-20260820`.
- Lease state at this checkpoint: `ACCEPTED_CHECKPOINT_WAITING_WAVE_C`.
  `heavy.owner` is not `explorer-monitor`; no further feature expansion,
  activation, deployment, or public-success claim is authorized until
  Integration grants the exact Wave C lease.
- The candidate consumes the accepted `errorContract`
  (`p0-wallet-connection-v1`, source `66003e76e804da16d472255efde50cb879055b96`).
  `monitorProbe` is accepted for source-level probe behavior only, while
  `publicEndpointManifest` and
  `clientRetirement` remain candidates and must not be activated as truth.

## Implemented candidate scope

`apps/monitor/server/p0-connectivity.ts` supplies bounded public HTTPS probes,
safe origin-only projection, optional safe release identity projection, EVM
chain-ID validation, and distinct classifications for transient RPC TLS
recovery, Product Session device-proof/protocol/expiry/gateway conditions,
relay/API failure, chain mismatch, and client retirement. It deliberately does
not implement a Wallet Provider, Product Session, Gateway, Wallet App, shared
SDK, financial product, or a client transaction flow.

The candidate must continue to keep public chain data separate from Gateway or
Product Session status. A successful HTTP response is endpoint evidence only;
it is not evidence of installed-client connection, signing, transaction, or
Product Session completion.

## Read-only evidence and baseline (2026-08-20)

The committed runtime inventory at
`release/integration/p0-wallet-connectivity/runtime-inventory-2026-08-20.json`
is the authoritative read-only sample for this checkpoint. It records:

- Native RPC and EVM RPC responding on testnet chain ID `6423`; the native RPC
  had an initial TLS timeout followed by a successful response, so the correct
  client-facing result is degraded/transient monitoring rather than a Gateway
  or Wallet-disconnected claim.
- Explorer, Wallet, and the public website were reachable over HTTPS when
  sampled. This does not establish installed-client evidence.
- Faucet health was reachable, but its version endpoint returned 404 and the
  health response exposed a loopback RPC URL. Treat this as
  `FAUCET_HEALTHY_BUT_VERSION_UNVERIFIED` plus
  `FAUCET_INTERNAL_DETAIL_LEAK`, not `HEALTHY`. The Runtime Owner must supply
  a public, source-identifiable version endpoint and remove the leaked detail;
  Explorer/Monitor must not patch the Faucet runtime.
- Native RPC identity data also contains internal configuration and is not a
  safe public identity input; the candidate must not republish it.
- The candidate public endpoint manifest is unsigned and
  `CANDIDATE_NOT_ACCEPTED`; its pending identity inputs cannot be used to mark
  any endpoint, app, artifact, or public deployment verified.
- The public Monitor currently serves its prior static application. Its
  `/connectivity` path falls back to the static shell rather than the P0 API,
  so the candidate connectivity route is **not deployed**.

Local candidate regression baseline passed: 45 monitor tests, 8 supporting
script tests, and the Monitor production build. This is local evidence only.

## Merge and release blockers

1. PR #107 CodeQL reports six new high-severity rate-limiting alerts in
   `apps/monitor/server/app.ts` authenticated/control-plane routes. The alerts
   are in the same newly introduced control-plane file, not the P0
   `/connectivity` route, but they still block a truthful merge claim. Address
   them only under the formal Wave C implementation lease.
2. Integration must accept and sign the public endpoint manifest after runtime
   source identity verification.
3. Runtime Owner must correct the Faucet version/response disclosure issue.
4. The standalone-app matrix remains `UNSCANNED`/`UNKNOWN`; web responses and
   GitHub prereleases are not installed-client evidence.
5. Shop Android remains retirement-in-progress until both public distribution
   and registry/session revocation are independently evidenced.
6. No public deployment, public verification, or Computer Control acceptance
   is claimed by this checkpoint.

## Next authorized work

After Integration grants the Wave C lease, resolve the CodeQL gate, consume
only then-accepted endpoint/retirement contracts, add configured public probes
without internal endpoint disclosure, run the dedicated no-secret fixture flow,
and perform deployment plus Computer Control verification. Retain the existing
probe model; do not recreate it.
