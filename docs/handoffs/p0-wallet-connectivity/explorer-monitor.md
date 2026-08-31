# Explorer and Monitor Handoff

## Superseding state (2026-08-31, current)

- Current source-bearing Explorer/Monitor checkpoint is
  `1a5d23ee80b6f1f2cd149cf779ba79853fa09de4`
  (tree `df8b55f5f7871fabb95d896909950d1279c50461`) on
  `codex/p0-explorer-monitor-20260820`, PR #107 Draft. It retains the real
  Indexer participant/activity, RPC balance, YNXT and chain-RPC contract work
  from the preceding source, and adds refresh-safe shell routes for factual
  block, transaction, address, token and contract detail URLs. Search returns
  the exact URL to revisit; malformed detail paths fail closed. Lookup errors
  now distinguish a real upstream 404 from unavailable dependencies without
  exposing upstream text, addresses or credentials. Account activity and the
  observed-participant leaderboard refuse an unhealthy or identity-mismatched
  Indexer. The initial and all 12 localized leaderboard states now describe
  only the observed Indexer-participant sample and explicitly reject a
  full-ledger-census claim. Its optional EIP-1193 compatibility connection now
  restores only the Provider explicitly chosen in the same browser tab, only
  after read-only `eth_accounts` and `eth_chainId=0x1917` checks. Refresh never
  selects a Provider, requests an account, or adds/switches a network; revoke,
  chain change and disconnect remove the remembered choice. The 12 locale
  dictionaries no longer retain a second, stale "full ledger when available"
  fallback: every locale gets leaderboard coverage wording from the one observed
  Indexer-participant source of truth.
- `apps/monitor/evidence/explorer-monitor-85e5f7da7-artifact-freeze-20260831.json`
  freezes all current-source artifacts with byte-identical rebuild evidence:
  `ynx-explorerd` SHA-256
  `8158ae80578d0f1d34d03d6d7065beba2f789d7e60441e4f3bbff1dd22dba3ec`,
  `ynx-indexerd` SHA-256
  `91aa40d63f10e72fdbf3a4c0da803dde5f96aedc94bd63b8f7ca71ae0f2184a4`,
  and deterministic Monitor release tree SHA-256
  `3ca26c420732ca0e901b5329bf7f9170fa112589c0cc01450a8096eb39e5d96a`.
  The former 0f23, 8df3 and every older artifact are forbidden from deployment
  with `85e5…`. This record grants no deployment authority: Central must bind
  these exact hashes to fresh production/rollback facts, remote CI and a new
  single-use lease.
- Final local evidence for `85e5…`: `go test -race ./internal/indexer
  ./internal/explorer -count=1` passes; Monitor `npm test` (55 application and
  10 script tests) and `npm run build` pass. `go test ./...` reaches
  unrelated pre-existing failures in `internal/bftgateway` and
  `internal/consensus`: a missing
  `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json`.
  Explorer and Indexer pass in that run. The final PR head must still have all
  required Security/CodeQL checks green before a Central deployment lease.
- Wallet boundary evidence is
  `apps/monitor/evidence/p0-159-wallet-consumer-router-source-gate-20260831.json`:
  Explorer search/detail and Monitor health/version/status/connectivity are
  guest-only public reads. Their optional explicit provider actions are
  separate `interactiveWalletConsumer` flows using user-selected EIP-6963 /
  EIP-1193 providers; no guest read is a Wallet connection and neither product
  consumes a Wallet Product Session. This is source/local evidence only, not
  public lifecycle evidence.
- Read-only public runtime evidence remains old and incompatible with this
  candidate: Explorer `/version` reports `8bf7716ee671…` (200, 331 bytes,
  SHA-256 `bc2982203cd9d2b8bb699b87e34205eeb8edf7bf13054d2c9569cf885ec106e5`),
  Monitor `/version` reports the same source (200, 264 bytes,
  SHA-256 `d0cb952655a41dad6a353f463c5b9f623f509b31303d35404e242a8a334b70ce`),
  and Monitor `/connectivity` is still a 641-byte HTML SPA fallback
  (`efbf2403f89259511dd861a6014e09d5fb11a7bf549a609bd17adacde41af44a`), not
  the required JSON API. `publicVerified` and Computer Control verification
  remain false.
- Before any production write, Central must issue a new scoped single-use
  lease binding the current-source artifacts to fresh runtime/rollback digests
  and the exact Monitor `/connectivity` JSON matcher. The deployment operator
  must capture rollback material before mutation, verify official source
  identity and JSON readback afterwards, then perform direct browser
  acceptance.

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
