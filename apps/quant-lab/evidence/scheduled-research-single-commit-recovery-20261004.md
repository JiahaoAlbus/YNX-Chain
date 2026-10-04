# Scheduled research: result commit and completion recovery

Ordinary Quant source correction inherited from
`607cec9a5c886897e79e7ed8587b5b9752d20f1a`, on the existing
`codex/exchange-sso-cookie-binding-20261002` branch. This extends the actual
result-persistence boundary, not just the preceding completion-receipt fix.
No shared Wallet/SSO/SDK/authority, formal artifact graph or public deployment
was modified. No Paper/Testnet capital action was executed.

## Reproduced whole-run gap

A scheduled experiment was committed, but its response could be lost before
the worker completed the claim. Re-delivering the same claim to the original
RunBacktest method created twelve more experiments, accepted changed costs,
market data and name, and even created a new experiment after terminal
completion. The unchanged new file test failed against inherited production:
`go test ./internal/quantlab -run '^TestScheduledResearchCommitReplayAndCompletionAreOneDurableRun$' -count=1`
FAIL, package 0.989s. Expected experiment-000002; concurrent replay instead
returned experiment-000003 through experiment-000014; later changed and terminal
deliveries reached experiment-000018. Durable audit/sequence changed. Original
failure is retained here rather than relabelled as success.

## Real persistence correction

The existing current strategy/enabled/RunID checks remain first. Under the
existing mutex and durable lock/reload, scheduled results are matched by the
existing experiment's strategy ID and recorded runtime RunID. An exact single
completed result with matching name, strategy/data/feature hashes and cost
assumptions returns the original detached receipt without a save. Conflicting
inputs or ambiguous historical matches return ErrConflict, without deleting or
repairing history. A finished run with no committed experiment cannot commit a
late result. A genuinely new due claim still computes and persists its own new
experiment. Stale, disabled and advanced claims retain their original fences.

No new persisted field or public idempotency protocol was introduced. Original
simulation/fee/slippage/drawdown/Sharpe arithmetic is unchanged. Calculation can
still occur before the commit fence; this ensures one durable effect, not a
claim of zero duplicate computation or a new distributed worker lease.

## Actual validation

File and real PostgreSQL tests use original Services, two independent service
instances, twelve simultaneous result retries, cost/data/name conflicts, cold
reopen, original completion replay, caller mutation of detached receipts,
next-due recovery, stale claim rejection and ambiguous historical-result refusal.
The file bytes and PostgreSQL revision+payload remain identical across replays.
An additional real-service test covers failed completion followed by late result
submission: no experiment/audit/state mutation is accepted.

- Final file+PostgreSQL scheduler/result/completion/configuration focused race
  count=3: PASS, package 3.912s (before adding the separate late-failure test).
- Full original Quant race suite with real PostgreSQL enabled: PASS, 16.309s.
  This includes original process/restart and worker recovery tests, not only an
  in-memory model. Production source was unchanged by the final test addition.
- Final file result replay plus late-failure race/count=3: PASS; exact elapsed
  result is in this turn's tool transcript.
- Original business-flow/records-session/research-recovery browser suite:
  109 PASS, 0 FAIL, 0 SKIP, 17271.352875ms.
- gofmt, Go vet and diff checks: PASS.

The browser test starts the actual Go service and two separate local Chrome
contexts against a controlled tape, preserves saved research across lost-return
and explicit recovery, and stops its service four times cleanly with SIGTERM.
It is local engineering evidence, NOT public provider approval, native install,
Mac ComputerControl or canonical private-service acceptance.

Retained local browser root:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-PPMNIF`

QA binary: 11516786 bytes; SHA256
`59c960666ac41a254e27eb6d6a9d1626ff19450f181627a7ca4f737236dade9a`.
It is a local QA build of the uncommitted candidate, not a signed installer or a
source-bound public version.

Screenshots under that root:
- `workspace-unavailable-en.png`, 208242 bytes, SHA256
  `60d29d03efe7f8edc222c9d13c070af1a6f46734d51cf8c5b3de6a76edd0891f`
- `workspace-recovered-en.png`, 191614 bytes, SHA256
  `ddfb02ecc53cda3d91b28811bfc4e52bc7c4709c9d2416e892754734caaaf489`

Retained loopback-only PostgreSQL QA cluster was verified stopped before start,
then reused (no recreation/data wipe). After tests, other client count=0 and
this test's namespace count=0; normal fast shutdown completed. Databases and
the cluster are preserved. Browser QA services ended normally.

## Remaining delivery boundary

This closes scheduled result/receipt duplicate-effect recovery in the original
owned engine. It does not complete the full financial ecosystem. Central A
must still assemble the compatible protected main/consumer/profile and formal
asset graph, then publish the exact approved runtime and verify actual public
Wallet/private-service/business journeys. Existing old public runtimes and
historical negative asset checks remain independent; no completion flag is
promoted by these local tests.
