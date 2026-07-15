# Trust Center and Resource Market handoff

## Branch and implementation commit

- Branch: `codex/ecosystem-trust-resource`
- Product implementation commit: `5391455fa0fd880c814b400f95a92986ac87371a`
- Baseline: `51bed84`
- Final handoff commit: the commit containing this document

This branch implements two separate products. It does not modify the root
Makefile, central Gateway policy, long-term goal, or acceptance state.

## Changed paths

- `apps/trust-center/**`
- `apps/resource-market/**`
- `internal/trustproduct/**`
- `internal/resourceproduct/**`
- `docs/handoffs/trust-resource.md`
- `docs/handoffs/evidence/{trust-center,resource-market}-{desktop,mobile}.png`

## Architecture

Both products are standalone Go services with embedded dependency-free Web
clients, versioned JSON persistence, atomic `0600` store replacement, exact
idempotency/replay conflict detection, product audit logs, CSP/security headers,
and fail-closed session authorization. Trusted actor/role headers are disabled
by default and exist only behind an explicit development flag. Production-style
requests use an opaque server-side session registry; the browser can consume the
accepted Sign in with YNX Wallet session through `sessionStorage.ynxSession`.

Trust Center persists evidence, bounded request scope, validity decisions,
illegal and overbroad rejection reasons, independent review, subject notice,
appeals, false-positive correction, visible label provenance, label expiry,
transparency aggregates and audit entries. Case owners cannot review their own
requests; initial reviewers cannot resolve the same appeal. No Trust action can
freeze, seize, blacklist or transfer native YNXT. Evidence is mandatory before a
valid conclusion.

Resource Market persists five capacity types (Bandwidth, Compute, AI Credits,
Trust Credits and Pay Credits), staking evidence, owner pools, bounded policy,
delegation, rental, beneficiary-consented sponsorship, expiry, capacity-only
revocation, fee quotes, income quote history, disputes and independent dispute
review. Every capacity record includes owner, beneficiary, resource type, limit,
source, expiry, fee and audit references. Sponsorship changes pool availability
only. The settlement field explicitly says that a fee remains a quote until
external authoritative settlement evidence exists.

Both AI workflows implement context selection, privacy preview, provider/model
status, cost estimate, explicit permission, SSE-backed YNX AI Gateway execution,
cancel, provider failure, result review state and audit. Trust AI only explains
evidence/classification/appeal. Resource AI only explains usage/cost/rental
options. Tests prove that AI creates no case decision, label, penalty, rental,
stake, sponsorship or transfer.

## Lifecycle and security evidence

Focused Go tests cover:

- Trust: evidence requirement, illegal native-asset request rejection, overbroad
  rejection, review separation, notice, sourced/expiring label, appeal,
  false-positive correction, transparency, restart, exact replay and changed
  input conflict.
- Resource: all five types, staking evidence, pool and policy, delegation,
  rental, beneficiary-consented sponsorship, required record fields, expiry,
  revocation, fee/income truthfulness, dispute separation, restart, exact replay
  and changed input conflict.
- Authorization: spoofed role headers fail in default mode; registered opaque
  bearer sessions succeed; development header mode must be explicitly enabled.
- AI: explicit permission, least-privilege context, provider-backed SSE, honest
  unconfigured/provider failure and no automatic domain mutation.
- Persistence: restart recovery, `0600` store permissions and idempotent replay.

Web tests run in Playwright Chromium at 1440x1000 and 390x844. They verify page
identity, keyboard skip-link focus, critical safety wording, no horizontal
overflow, empty states, primary submission/create flows, permission preview and
honest AI provider failure. Go UI contract tests additionally check semantic
labels, viewport, Klein Blue, reduced-motion, focus and responsive rules, and
ensure the two products are not merged.

## Test output summary

Passed:

```text
go test -race ./internal/trustproduct ./internal/resourceproduct
ok internal/trustproduct
ok internal/resourceproduct

GOMAXPROCS=2 go test ./...
all packages passed

make test
all cmd/internal packages passed

./apps/trust-center/check.sh
trust-center-check: ok

./apps/resource-market/check.sh
resource-market-check: ok

cd apps/trust-center && npm run test:ui
3 passed

cd apps/resource-market && npm run test:ui
3 passed

make no-placeholder-check secret-scan env-check objective-state-check
all passed
```

The repository's IDE tests require
`artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json`.
This artifact exists in the base repository workspace but is not tracked in this
worktree. The full `go test ./...` and `make test` runs passed with a temporary
read-only symlink to that existing generated `artifacts` directory; the symlink
was removed immediately after each run and is not part of this branch.

## Screenshots

- [Trust Center desktop](evidence/trust-center-desktop.png)
- [Trust Center mobile](evidence/trust-center-mobile.png)
- [Resource Market desktop](evidence/resource-market-desktop.png)
- [Resource Market mobile](evidence/resource-market-mobile.png)

The screenshots contain empty persisted state, not invented users, transactions,
market volume or public chain metrics.

## Security boundaries

- Native YNXT cannot be frozen, seized, blacklisted, confiscated or transferred
  by this product.
- Trust labels require evidence, explicit human review, visible source and finite
  expiry; appeal cannot be removed.
- Resource operations move only bounded capacity. No private key, Wallet secret,
  token debit or asset transfer path exists.
- Role headers are rejected unless the development-only flag is explicitly set.
- AI provider keys stay server-side. AI context classes are allowlisted and
  provider failure is not replaced with canned output.
- Persistence contains domain/audit records only. It contains no provider secret
  or Wallet recovery material.

## Incomplete external/integration items

No production deployment or public availability is claimed. The product-local
JSON store is durable for a single service process but is not a multi-node HA
database. Production session issuance and signed chain mutations intentionally
remain outside this branch because the main integration task must first accept
the Wallet authorization contract and central Gateway bindings.

The local product ledger is a real persistent case/capacity workflow ledger, but
it must not be described as authoritative chain settlement. Existing
`ynx-trustd` and `ynx-resourced` remain the authoritative signed API boundaries.

## Exact integration requests

1. Register distinct least-privilege Gateway clients and accepted Wallet session
   bindings for Trust Center and Resource Market; inject opaque session tokens,
   never user-selectable roles.
2. Add reviewed adapters from product workflow actions to existing signed
   `ynx-trustd` and `ynx-resourced` mutations. Preserve Wallet review, nonce,
   idempotency, committed-response verification and all current Gateway policy.
3. Add central deployment/systemd/reverse-proxy configuration for ports 6440 and
   6441 only after session, TLS, backup/restore and rollback review.
4. Provision product-specific YNX AI Gateway scopes for Trust explanation and
   Resource cost/option explanation. Do not grant action, asset, label or
   permission mutation scopes.
5. Schedule `expire_labels` and `expire_resources` with the system role at an
   integration-owned cadence and monitor audit persistence failures.
6. Replace the single-process store with the integration-approved durable store
   before any HA or production claim; retain versioning, replay and audit
   semantics.

There are no claimed public deployment, mainnet, store acceptance, partnership,
independent audit or independent proof results in this branch.
