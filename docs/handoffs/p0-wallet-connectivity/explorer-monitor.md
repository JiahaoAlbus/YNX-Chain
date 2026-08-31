# Explorer and Monitor Handoff

## Superseding state (2026-08-31, current)

- Current owner source checkpoint is `cd9baa29cc198ccfa624fea726efddd84c905953`
  (tree `9e3eef3ac4e8ff2f5946649d30533e2854e473cc`), on
  `codex/p0-explorer-monitor-20260820`, PR #107. Its source-bearing parent is
  `a3292a2b6d30409caf7db66b81c47e8d09ad76f1`: both Explorer and Monitor now
  use EIP-6963 provider discovery with EIP-1193 account approval, `0x1917`
  add/switch/readback and lifecycle invalidation. They have no top-level
  Wallet custom-scheme navigation or pasted-signature input. Guest Explorer
  search/detail and public Monitor status remain unauthenticated reads.
- The only current release candidate artifacts are frozen in
  `apps/monitor/evidence/p0-160-wallet-consumer-release-preparation-20260831.json`.
  Its Explorer binary, Indexer binary and Monitor release-tree hashes all come
  from `a3292a2b…`; P0-157 and every earlier artifact generation are forbidden
  from deployment with this successor source.
- Direct public evidence remains mixed: native RPC reports chain ID `6423` and
  EVM reports `0x1917`, while Explorer, Indexer and Monitor serve the older
  `8bf7716e…` release. Monitor `/connectivity` is still the 641-byte HTML
  fallback rather than the required JSON API. This means candidate deployment,
  public verification and Computer Control verification all remain false.
- Before any production write, Central must issue one scoped lease binding the
  current artifact hashes to freshly captured runtime/rollback digests and the
  exact Monitor `/connectivity` matcher. The deployment operator must capture
  the rollback material before mutation, verify official source identity and
  JSON readback afterwards, and then perform real browser acceptance.

## Superseding state (2026-08-22)

- Current owner checkpoint: `ee3c398adf80659215d06806911068a48551ab03`
  (tree `6a1cfaf9e8817281eb7a33cd32825126d431d367`), PR #107 Draft; all
  six current CI checks, including CodeQL, are green.
- The only successor source generation for any new release request is
  `49cbb1507e25f4681018af883da7e4649e415de9` (tree
  `54c1100a36b45d3e9955fb4ba0504042bab1d73a`). P0-145's older
  `857150…` artifacts are integrity-accepted rollback evidence only and must
  not be combined with this successor.
- Fresh read-only runtime mapping, successor artifact hashes, rollback receipt
  fields, public baseline, and the new bounded lease request are frozen in
  `apps/monitor/evidence/p0-147-successor-runtime-lease-request-20260822.json`.
  The current public release remains `8bf7716e…`; Monitor `/connectivity`
  still serves the 641-byte HTML fallback rather than its JSON API.
- Wallet classification is explicit: Explorer guest browsing requires no
  Wallet, while its MetaMask compatibility action is an incomplete interactive
  Wallet consumer. Monitor guest status reads require no Wallet, while its
  privileged wallet-sign-in flow is an incomplete interactive Wallet consumer
  that currently uses a prohibited top-level custom-scheme navigation. Neither
  product has direct public Wallet E2E evidence.
- No deployment, public verification, or Computer Control acceptance is
  claimed. A new single-use lease bound to the successor artifacts, current
  runtime digests, exact ingress matcher, rollback receipt and official-domain
  verification is required before production mutation.

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
