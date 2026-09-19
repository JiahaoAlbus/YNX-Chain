# Weekly v3 cross-product integration checkpoint

## Current status: official-wire correction awaiting product checkpoint

The historical local PASS below remains valid only for its deliberately scoped
old fixtures. Subsequent official-document inspection found that those fixtures
were too simplified to establish Broker wire compatibility. Stage A is **not**
complete. No historical evidence file has been overwritten.

The corrected integration assets now preserve the complete public
[Trading Account example](https://docs.alpaca.markets/us/reference/gettradingaccount)
and [TradeUpdateEventV2New example](https://docs.alpaca.markets/us/reference/subscribetotradev2sse)
in `scripts/verify/weekly-v3/broker-wire-fixtures.json`, with source URLs and raw
OpenAPI SHA-256 provenance. These are public documentation examples, not real
Sandbox account data. An independent nine-test integrity suite checks their
content and rejects weakened fixtures; five runner-guard tests use only temporary
local Git repositories to reject dirty, mismatched or unpublished inputs and
preserve historical evidence. Product integration on these corrected
fixtures is pending a new clean, pushed Finance checkpoint.

Corrections and additional assertions:

- Cash and buying power come only from
  `/v1/trading/accounts/{account_id}/account`; the ordinary AccountExtended
  fixture never acquires fictitious cash fields.
- Preserve the official `103556.8572572922` buying-power string, all documented
  Order fields, null values and `extended_hours`. Never truncate a sample to fit
  a decoder or confuse provider balance precision with permitted order precision.
- Preserve different `at` and `timestamp` values: they have different meanings.
  Invalid times, event/account mismatch and invalid order types remain negative
  cases. Blocked or missing critical account safety flags must not allow POST.
- Continuous-flow derivatives replace only synthetic identities, submitted
  intent and lifecycle values. They retain the full Order shape. Event SSE
  framing remains explicitly a local fixture, not proof of provider transport.
- Runner requires published owner branch heads and clean Finance source; Wallet's
  unrelated packaging manifest remains outside the owned product-source gate.
  Integration asset hashes are checked before and after the test, as are product
  source identities. A local PASS still does not set `stageAComplete=true`.

Credential-independent work still requires complete Finance navigation/search,
watchlist, user cancellation/reconciliation, worker event transport and activation
tooling acceptance. Finance owns those implementations. This integration writer
does not patch Finance or Wallet product source or activate deployment.

Preparation checks:

```sh
node --test scripts/verify/weekly-v3/broker-wire-fixtures.test.mjs
node --test scripts/verify/weekly-v3/integration-runner-guards.test.mjs
node --check scripts/verify/weekly-v3-finance-wallet-integration.mjs
git diff --check
```

## Historical repaired local result (simplified fixtures)

The original failure evidence below is preserved. On Finance
`a3e5d21b91443e6db4d9cad2d38e112773e9a57f` and Wallet
`bd977cd2d382c4c43a435c8e415e698205b8a102`, the complete local fixture suite
passes **without** a diagnostic Date adapter. The actual Finance bundle includes
the repaired Wallet verifier. Exact owner worktree source is checked before and
after execution; the unrelated Wallet artifact manifest remains preserved.

The continuous flow executes manual and AI-copy forms → server challenge →
actual Wallet approve/reject/revoke → actual Finance callback handler → durable
CAS/outbox. For approved orders it then executes actual provider-adapter
preflight → lost ACK → reopen/query → partial-fill event → non-mutating duplicate
event rejection → cancel → reconcile. Before every tested POST, assertions require
Account, Assets, Quote and Positions reads. No test bypasses the new preflight.
Separate negative cases cover zero cash despite margin buying power, expired
approval, late redispatch not rewriting an already-confirmed order, and revoking
an unused approval whose approval callback never reached Finance.

The VM fetch bridge parses response JSON inside the browser realm, as a real
browser does; it does not change response fields, dates, signatures or authority.
Duplicate events may be explicitly rejected; their complete journal/cursor/order
state must remain byte-identical. An initial test incorrectly required a nil
duplicate error; this was corrected to test the actual safety invariant. This is
not evidence for an activated live SSE worker or official event transport.

Evidence:
`release/evidence/weekly-v3-cross-product-a3e5d21b-bd977cd2-20260919.json` and
`release/evidence/weekly-v3-network-wallet-bd977cd2-20260919.json`.
Finance independent regressions pass 58/58 front-end tests and Go race tests for
`./internal/finance/... ./apps/finance/cmd/...`. Wallet/network regression passes
38 endpoint/profile tests, Faucet 40-user race/recovery, SDK compatibility,
20 approval/transport, 67 extension/provider and 143 controller/time/Faucet tests.

The overlay source has the `weekly_v3_integration` build tag and the runner
explicitly enables it only in the Finance overlay. Default `go list ./...`
excludes this otherwise non-standalone test package. No full ecosystem Go test
run is implied by that package-inventory check.

Historical six states at the checkpoint: code implemented; scoped local contract/fixture integration
PASS; official Sandbox=false; public deployment=false; public verification=false;
production approval=false. `localFixtureEndToEndVerified=true` does **not** promote
`crossProductE2EVerified` (installed/public), official verification, or production.

## Scope and recovery

This runner adds integration assets only. It never edits Finance or Wallet
product source, calls an official Broker endpoint, changes DNS, deploys, or
touches existing chain/account state. Go `-overlay` injects the test into a pinned
Finance checkout; all Finance state and HTTP/TLS listeners are temporary.
The preserved implementation baseline is network `79af8b249`, Finance
`cf89d852c9f8630e1980d9f0418adc901053835f`, Wallet
`ab4dfa927be3d16fde3048b72d705d90c770dcd3`.
Finance has repaired the findings below in the later checkpoint above. A detached
read-only snapshot at `/private/tmp/ynx-weekly-v3-finance-baseline.9XQFci/finance`
preserves reproducibility of the original failures. Do not reset the owner tree
to reproduce them. The unrelated Wallet artifact-manifest dirty file is untouched.

## Reproduce

From this network worktree:

```sh
node scripts/verify/weekly-v3-finance-wallet-integration.mjs \
  --finance-worktree /path/to/exact-finance-checkout \
  --finance-commit FULL_NEW_CLEAN_PUSHED_FINANCE_COMMIT \
  --wallet-worktree /path/to/exact-wallet-checkout \
  --wallet-commit bd977cd2d382c4c43a435c8e415e698205b8a102 \
  --output /path/to/new-evidence.json
```

To reproduce an old evidence file, use its exact integration assets at network
`d58c9d1ea` (original failures) or `c66b498c7` (simplified-fixture PASS) in a new
detached worktree. Do not reset an owner worktree or run this corrected fixture
suite and label it as a reproduction of the old PASS. Current runner enforces
published owner branch heads; the historical runner preserves its original
checkpoint rules.

For reproducing the historical cf89d852/ab4dfa927 failure checkpoint only,
`--diagnostic-date-adapter true` is ONLY for isolating downstream defects in the
broken original Finance build. The real browser scope/time/manual/AI checks never
use it. After Finance fixes its boundary, OMIT this flag and test its new exact
commit: the normal/default mode makes no timestamp conversion outside product
code. The report records adapter use and SHA-256 hashes of the integration assets.
An existing output is never overwritten. Dirty or changed product sources fail
the checkpoint guard. A failing test yields nonzero, not an acceptance result.

## What executes

- Actual `app.js` API/form/AI-copy handlers in a minimal browser VM, not source
  regex assertions. AI input is a labelled fixture; no real AI generation claim.
- Actual Finance `order-wallet.js` bundle, fixed callback transport and actual
  Wallet controller, with the frozen public test key, fixture secure storage,
  fixture trusted time and a simulated callback delivery failure.
- Real Finance HTTP routes with an explicit scope-aware authority decision
  fixture, real signatures, order challenges, CAS, persistent store and reopen.
  This is not a deployed Product Session authority or installed Wallet UI test.
- Actual Alpaca adapter to a loopback TLS provider fixture. The socket is pinned
  to localhost and trusts the fixture certificate; TLS verification is not
  disabled. Synthetic credentials and a synthetic activation receipt exist only
  in the test. No official Alpaca call is made.
- Submit ACK, accepted-but-dropped HTTP response, query/reconcile, cancel ACK vs
  final cancellation, persistent reopen and restart-during-dispatch fencing.
- Negative delayed-event, identity mismatch, expired approval and provider-shaped
  event parsing checks. These intentionally remain red on the original build.

## Findings on Finance cf89d852 / Wallet ab4dfa927

| Finding | Reproduced effect | Owner |
| --- | --- | --- |
| Browser scope | Both challenge and callback request portfolio.read; HTTP routes require profile.write, producing 403 | Finance |
| Authority time | Actual server JSON timestamp passed to SDK requiring Date produces INVALID_TIME | Finance |
| Unused revocation callback | Wallet creates revoke; Finance cannot parse it without the previous approval proof | Finance, shared protocol review if needed |
| Delayed event | fill/event-2 followed by old new/event-1 regresses filled to submitted and reverses cursor | Finance |
| Reconcile identity | Same client ID but wrong asset, symbol, side and quantity is accepted as filled | Finance |
| Expired outbox | Approval expires 09:05:30; dispatch at 10:00:30 still sends provider POST without fresh execution evidence | Finance |
| Provider event DTO | Order fields used by the adapter's own provider HTTP format are rejected by the SSE decoder expecting internal camelCase; complete official SSE envelope still requires owner verification | Finance |

Manual and AI-copied draft launch both reproduce the same scope blocker; they
are not additional independent defects. All findings were sent to the original
coordinator, who controls the Finance repair window. No owner source was patched
by integration.

## Historical failure results and truth boundary

Evidence: `release/evidence/weekly-v3-cross-product-cf89d852-failures-20260919.json`.
Cross-product acceptance FAILED on that original checkpoint. With the explicitly recorded Date adapter only,
approve/reject → real callback validation → durable CAS/replay checks pass.
Actual adapter submit, lost-ACK unknown → query, cancel, reopen and interrupted
dispatch tests pass against the local TLS fixture, exactly one provider POST per
logical order and one DELETE for a cancellation. These partial results do not
override the failed complete flow.

Independent owner regressions: Finance internal/brokerage Go race tests and
Finance command race tests pass; all 54 Finance front-end tests pass. The first
command used nonexistent root `cmd/*` paths and failed setup; it is not counted
as a successful command. Correct command paths are `./apps/finance/cmd/...`.
The network/Wallet gate passes 38 endpoint/profile tests, Faucet race tests with
40-user shared-alias recovery, SDK backward compatibility, chain metadata,
19 approval/transport tests, 67 Wallet extension/provider tests and 142 Wallet
controller/time/Faucet tests. Its separate evidence remains local-only.

| State | Result |
| --- | --- |
| Code | Integration regression assets implemented; product owner fixes pending |
| Contract/local | Network/Wallet and owner regressions pass; complete cross-product flow FAILS |
| Official Sandbox | false — credentials and explicit bounded verification permission pending |
| Public deployment | false for weekly checkpoints |
| Public verification | false; no alias activation or installed Wallet acceptance |
| Production approved | false; Mainnet and live trading disabled |
