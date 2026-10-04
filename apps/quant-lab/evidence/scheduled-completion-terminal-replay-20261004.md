# Scheduled research completion: durable terminal replay

Source-only ordinary Quant correction, inherited from owner checkpoint
`af14a71ca7489932d923402624dd3ab1f1059995` on
`codex/exchange-sso-cookie-binding-20261002`. No shared authority, deployment,
installer, real Wallet approval or capital execution is part of this change.

## Reproduced defect

The real Service completion method accepted repeated delivery of a completed
claim. Twelve concurrent calls through two independent Services changed its
completion time, wrote more audit entries, and accepted a conflicting experiment
ID. The same defect appeared for completed, failed and cancelled research runs.
The unchanged new regression failed against inherited production code:
`go test ./internal/quantlab -run '^TestScheduledCompletionReplayPreservesTerminalReceipt$' -count=1`
returned FAIL (package 0.499s). Original completion time 00:01:00 became
00:01:01; conflicting terminal accepted with nil error; durable bytes changed.
This is a local original-engine regression, not an observed public incident.

## Correction and actual coverage

Within the existing mutex and durable lock/reload, a non-running terminal claim
returns its retained status, experiment and timestamp without saving if the
outcome agrees; a conflicting status/experiment returns ErrConflict. Explicit
stop statuses are not mistaken for completed receipts: their original first
cancelled completion remains available. Different/stale RunIDs still hit the
original conflict fence. No new state schema, scheduler formula, signature,
mandate, API or protocol was added.

Actual regression executes the original Service, actual persisted file state,
original backtest for the completed outcome, twelve concurrent duplicate
completions through two Services, conflicting completion, and cold Service
reopen. All three terminal outcomes retain byte-identical persisted state and
original receipt. This is internal worker delivery idempotence, not a claim of
public request authentication or a newly implemented transport retry mechanism.

## Executed gates

- Focused original scheduler, configuration retry, context/lifecycle and new
  completion tests: race/count=3 PASS, package 3.066s.
- Full `go test -race ./internal/quantlab`: PASS, package 4.798s.
- `go vet ./internal/quantlab`, gofmt and `git diff --check`: PASS.
- PostgreSQL opt-in not configured for this batch: PostgreSQL-specific cases
  remain skipped, not newly passed. Earlier real PostgreSQL results are separate
  inherited evidence and are not promoted by this file.

No public deployment/HTTP/visible browser/provider/OS installer test was run for
this backend-only change. Formal source graph/asset binding and public delivery
remain with the central release owner; old public runtime is not this candidate.
Testnet/Paper orders, private Product Session and user acceptance remain separate
unproved gates. No process or database was left running by this batch.
