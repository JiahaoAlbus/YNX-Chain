# Weekly v3 cross-product integration checkpoint

## Reopened acceptance window: B1–B4 (not yet product-tested)

The sole coordinator reopened NETWORK's second writer slot for acceptance
assets only after the full-requirement audit found four gaps outside the
81-case scope: real HTML AI-start/FormData, provider-rejected terminal recovery,
default-off gated product execution, and securities AI with no YNXT activity or
an unavailable Explorer. Finance/Wallet product files remain owner-only.

New assets prepare unchanged real HTML/script loading in headless Chromium,
native FormData and actual button-click → Finance HTTP → local Gateway → durable
job → reviewed-form copy. Three cases cover owned activity, empty chain activity
and Explorer 503. Session proof is an explicit synthetic fixture, not an
installed Wallet claim. All browser network is intercepted and restricted to
the isolated Finance server; only AI-job creation is an allowed write. The
acceptance adapter never repairs the DOM or injects an AI result.

Four new provider-rejection cases cover polling/events with both accepted ACK
and lost ACK. Each requires preserved provider identity, consumed Wallet
approval, a non-dispatchable terminal outbox, reopening persisted state, and no
regression from late accepted events or stale polling. Exactly one initial
provider POST and zero DELETEs are expected. Full execution awaits Finance's
clean, published interface freeze; new test presence is not a product PASS.
The B3 route/receipt/idempotency tests await that same frozen owner contract.

Preparation verification: **41/41 harness self-tests PASS**, including a real
Chromium native-FormData regression probe using a synthetic HTML page only
(DIV throws TypeError; FORM yields the value). This dependency-only probe does
not load a moving Finance worktree's HTML/scripts. `git diff --check` and Node
syntax validation pass. The seven new Go product cases are prepared, not run.

The previous 81/81 report and source checkpoint below are immutable historical
evidence. To reproduce that exact scope, use NETWORK `1f24904049a1bc399a67ca8c9493237e3c5f9077`;
the expanded runner in this window must not be presented as that earlier run.
All official/public/production flags remain false.

## Latest expanded local acceptance: 81/81 PASS

Finance `cb904735f6f03364f71e41172405ee12e0f5f152`, tree
`e64348c00c6050f8fc875562b8b301e9ba00764a`, and Wallet
`bd977cd2d382c4c43a435c8e415e698205b8a102` pass **26 root groups / 81 leaf
cases** with Go race enabled. Exact unchanged NETWORK `1f24904049a1bc399a67ca8c9493237e3c5f9077`
acceptance assets were used: all 12 source hashes match that commit; product
and integration stability gates are true, with no diagnostic Date adapter.

Evidence:
`release/evidence/weekly-v3-cross-product-cb904735-bd977cd2-20260919.json`.
Independent final-Finance regressions: Go race across Finance/command packages
PASS; npm **60/60** PASS; harness **35/35** PASS. These are local results only.

The owner fix `c47c88df2a6ac6140116af99feb1ecc892adbb95` reuses canonical
backend numeric rules for AI input/output and requires exact root/nested field
sets. The same three previously failing HTTP/Gateway job cases now fail closed;
the positive persisted-job/browser-copy case still passes. No assertion or
fixture was weakened. Initial failure evidence below remains immutable.

Read-only source review confirms the activation guide now documents the real
doctor read coverage and one-shot worker flow, the env/schema include owner
verification plus fee-bound inputs, and the integration/operator request no
longer incorrectly require unwired public provider-submit routes. Their contract
test is included in the 60-test Finance regression.

Integration's assigned completion-pack acceptance is complete and its writer
slot is released after publishing this evidence. This scoped pass is not a
certificate for all attachment requirements: the report intentionally preserves
`stageAComplete=false` pending the sole coordinator's full requirement audit.
Official Sandbox credentials/entitlements/funding and separately authorized
low-frequency writes remain external gates. Real model, installed/public Wallet
approval, successful PostgreSQL/multi-host persistence, public deployment and
new RPC/Faucet alias verification are not established by this suite.
`officialSandboxVerified`, `publicDeployed`, `publicVerified` and
`productionApproved` remain false. Mainnet and live trading were not enabled.

Reproduction (run from the NETWORK worktree at the delivered assets):

```sh
node scripts/verify/weekly-v3-finance-wallet-integration.mjs \
  --finance-worktree '/Users/huangjiahao/Desktop/YNX Final Worktrees/24-finance-flow-20260912' \
  --finance-commit cb904735f6f03364f71e41172405ee12e0f5f152 \
  --wallet-worktree '/Users/huangjiahao/.codex/worktrees/6efe/YNX Chain' \
  --wallet-commit bd977cd2d382c4c43a435c8e415e698205b8a102
```

For an additional evidence file, choose a new path with `--output`; the runner
refuses to overwrite an existing report. It also refuses dirty/unpublished owner
source. Recovery uses the published branches/checkpoints, never reset/clean of
an owner tree. No product or chain-state rollback is required for this test-only
delivery, and no existing data or service was removed.

## Preserved expanded Stage A failure: strict AI schema defect

Frozen Finance `f8c55f3c96fc3a5db374bc77a3cbef4ce156523d` (tree
`d56d2eb8ba3e4ecf1faa86ed83a909ee87f9d618`) and Wallet `bd977cd2d` were
tested without changing either owner worktree. The expanded suite has 26 root
groups / 81 leaf cases: **78 pass, 3 fail**, with both product and harness
stability gates true. This is NOT an all-pass acceptance checkpoint.

The three failures traverse actual Finance HTTP job creation, actual Gateway
HTTP/SSE parsing and persisted AI job state. Otherwise-valid model results with
`qty="2/1"`, `limitPrice="1e2"`, or root `execute=true` become `ready`, rather
than failing strict schema validation. No executable order or provider write is
created by the AI cases. This is a draft-validation defect, not evidence of a
Wallet or order-approval bypass. It was returned to the sole coordinator for
Finance-owner repair; integration does not edit Finance source.

Evidence is preserved in
`release/evidence/weekly-v3-cross-product-f8c55f3c-strict-schema-20260919.json`.
Earlier narrower runs (`initial`, `recovery`, `operator` suffixes) remain intact;
the operator run passes 26 roots / 78 leaves but predates the three new negative
schema cases, so it cannot certify the expanded suite.

New passing coverage includes:

- Real Gateway fragmented SSE → Finance HTTP job → durable reopen → actual
  browser copy into a reviewed draft, with no private request during copy.
  Malformed/truncated/prose/auth/rate-limited results do not become usable jobs.
- Real Wallet-approved held-position sell and insufficient available holdings;
  partial-fill cancellation race and cancellation lost-ACK without blind retry.
- Real adapter TLS polling across 501 complete-shaped orders, finding an unknown
  target on page two after reopening state; exactly one provider POST remains.
- Persistent independent event/poll checkpoints, equal-time different orders,
  duplicate and cross-tenant rejection, authenticated recovery output and no
  checkpoint leakage to another owner.
- Quote wire state and execution fences: fresh/delayed/old/future/unentitled.
  The display's delayed label does not imply execution eligibility: the separate
  execution preflight rejects quotes older than two minutes.
- Actual operator `doctor` / read-only `sandbox-verify` probe with fixture auth,
  mapping/account/assets/positions/orders/quote, unchanged state and zero writes;
  disabled activation plans perform zero network requests.
- Actual Wallet controller signature → `verify-approved` command → provider
  POST/query/DELETE/reconcile → persisted canceled state and audit receipt;
  repeat invocation cannot repeat writes. Disabled writes, missing approval and
  invalid configured database are rejected without provider I/O or file changes.

All provider sockets are pinned to ephemeral loopback TLS fixtures. The AI
Gateway is a deterministic local responder, not a real model. Command overlays
are injected with Go `-overlay`; owner files are not modified. PostgreSQL
success/multi-host persistence and installed GUI are not verified by these tests.

Independent frozen-Finance regressions pass: Go race across Finance and command
packages, plus npm 59/59. Harness self-tests pass 35/35. `stageAComplete=false`,
`officialSandboxVerified=false`, `publicDeployed=false`, `publicVerified=false`,
`productionApproved=false`. The attachment's Stage B means official credentialed
Sandbox verification and has NOT started; owner checkpoint labels do not change
that definition.

## Stage A completion-pack tests in preparation (not product acceptance)

Historical preparation record (superseded by the expanded tests above):

Following the coordinator's read-only scope audit, a second integration-only
writer window prepares tests for remaining Finance Stage A work. New owner
interfaces must be frozen and published before these prepared tests are run.
No Finance/Wallet source is edited by integration.

- Existing-contract Go overlay cases now include owned-position sell and
  no-position/reserved/fractionally-insufficient available quantity; partial fill
  racing cancellation; lost cancellation ACK, no blind retry and restart/query.
- An ephemeral loopback Gateway serves deterministic fragmented HTTP/SSE, plus
  authentication failure, rate limiting, invalid structured output, untrusted
  prose, malformed SSE and truncation. It is never a model or public Gateway.
  Ten self-tests verify the fixture itself, not the Finance product.
- A prepared overlay exercises the actual existing HTTPAIProvider transport.
  The runner executes Go asynchronously so the local Gateway listener remains
  live, then closes every listener and hashes its source with the other assets.
  Its report explicitly keeps real model generation false. A dedicated
  structured-input → persisted AI job → copy test still awaits owner API freeze.
- Pure recovery vectors preserve complete Order shapes across 501 results,
  place the unknown target beyond page one, include same-time different-order
  events, separate accounts, duplicate/delayed events, provider resume cursor,
  and fresh/stale/future/unentitled quote cases. Eight self-tests verify the
  vectors; they do not substitute for product recovery tests.
- Doctor/verify/activation and backend-selection acceptance awaits the owner's
  frozen command contract. No invented CLI or success placeholder is added.

Preparation checks are syntax/format/diff checks and isolated fixture self-tests.
The last accepted product result remains the exact NETWORK `9747feb2e` assets
below. Running newer preparation assets is not a reproduction of that result.

## Last accepted result at NETWORK 9747feb2e: expanded local flow PASS

Finance frozen checkpoint `b46bdae971fef9a4fd1f4b210e4aaf3174a25c3b`
(tree `0c4d47c99d13946b58b10f29cdf58911dfb7227a`) and Wallet
`bd977cd2d382c4c43a435c8e415e698205b8a102` pass **16 root groups / 44 leaf
cases**, Go race enabled, without a diagnostic Date adapter. Owner source and
integration asset hashes remain unchanged throughout; published branch heads
match. Evidence:
`release/evidence/weekly-v3-cross-product-b46bdae9-bd977cd2-20260919.json`.

The browser bridge now follows actual provider-backed search/rendered Select,
watchlist update, quote and account reads before manual or AI-copy approval.
It never injects selected-asset state. The approved flow then exercises actual
Wallet/server signatures and durable CAS, adapter preflight, lost ACK, reopen,
partial event, non-mutating duplicate, a fresh browser context with persisted
watchlist, confirmed user cancellation intent, worker cancellation and browser
reconciliation. Browser cancellation is explicitly asserted to send zero provider
DELETEs before the worker. AI results remain labelled fixtures, not a model run.

The mapping fixture uses the new server-owned Wallet-key mapping API, with the
same frozen public test key, not manual browser public-key entry. Complete public
wire examples remain byte-content pinned. Twelve account-fence cases cover true,
missing, null and wrong-type values for all three required safety flags; all
prevent provider POST. Exact decimal precision and valid distinct timestamps pass.

The first `1f4cc12f` run exposed missing flags being treated as false (real Finance
defect), plus two integration defects: outdated search-less browser flow and an
overstrict expectation that normalized occurrence time must equal publication
time. The latter are corrected in this test harness without modifying official
examples. Both timestamps are independently checked, and at-only fallback is
tested. Finance repaired the required-flag defect in `b01841ad`.

The `b01841ad` test run passed all tests but was **not accepted**: an owner evidence
file appeared during execution, so the source-stability gate stayed false. Both
initial reports are preserved as `weekly-v3-cross-product-1f4cc12f-initial-failures-20260919.json`
and `weekly-v3-cross-product-b01841ad-unstable-input-20260919.json` in
`release/evidence/`. The accepted run waited for the final frozen `b46bdae9`.

Independent regression on product implementation `b01841ad`: all
`go test -race -count=1 ./internal/finance/... ./apps/finance/cmd/...` packages
pass and Finance `npm test` passes 59/59. The only change from that implementation
to final `b46bdae9` is its preserved evidence JSON. The 9 fixture-integrity and
5 runner-guard tests also pass. These are separate from official/live acceptance.

`localFixtureEndToEndVerified=true`; `stageAComplete=false`,
`crossProductE2EVerified=false`, `officialSandboxVerified=false`,
`publicDeployed=false`, `publicVerified=false`, `productionApproved=false`.
The suite does not prove installed GUI, live AI generation, authenticated provider
event transport, deployed Product Session authority, or every Stage A operator
activation requirement. Those need their own scope-matched evidence.

## Official-wire correction provenance

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
fixtures passes at the frozen checkpoint above.

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

Search, watchlist and user cancellation/reconciliation now have the local flow
evidence above. Worker event transport, AI generation and activation tooling need
their own complete acceptance evidence. Finance owns those implementations. This integration writer
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
  --finance-commit b46bdae971fef9a4fd1f4b210e4aaf3174a25c3b \
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
