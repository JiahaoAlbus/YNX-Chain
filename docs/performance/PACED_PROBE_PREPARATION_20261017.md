# Preparation for the next bounded offered-rate measurement

The first four-node result is preserved in [the 32-transaction report](FOUR_NODE_SMOKE_20261017.md). Its runtime binaries remain separate from this new candidate. No new network window was executed while preparing this source.

## Load generator

The client and fixture now accept up to 256 transactions. Positive `-offered-rate` creates scheduled offers with separate bounded submitter and observer pools. At most 4 submission RPCs and 4 observation lifetimes are active; all queues are bounded by the <=256 inputs. The first sender nonce is independently signed for each temporary account, preserving the existing committed-nonce admission rule.

The next proposed scenarios are 128 or 256 transactions at an offered rate of 64/s, subject to Root's fresh slot. Their planned offer spans are approximately 2 or 4 seconds. Setup, observation and drain must all fit the existing 10-second client deadline. No timeout extension, worker increase or automatic transaction retry occurs when work cannot complete.

Reports separate configured rate, measured offer/submission interarrival rates, queue delays, per-stage successes/failures, full observation-window effective inclusion/final-submission rates and per-transaction confirmation latency. Signed header time and block transaction index are retained. Short finite probes do not establish steady state; that metric stays null until an appropriate sustained measurement exists.

Unit checks prove the scheduler submits remaining offered work while an earlier confirmation is blocked, stops unoffered work after cancellation and neither observes unknown submissions as accepted nor retries them. Existing actual signature/quorum, inclusion-proof, persistent-state and tamper checks remain in the confirmation path. These scheduler tests are workflow tests, not additional business transactions or network TPS evidence.

## Resource telemetry

A small prebuilt macOS C helper reads `PROC_PIDTASKINFO` for each owned/control PID. It records actual kernel thread counts, RSS and virtual size. Once per second, it enumerates host processes, reports process-limit values without modifying them and performs one ordinary fork followed by wait/reaping. Fork syscall errors, wait errors and child status are separate.

The helper resets SIGCHLD to the default only inside its own process so inherited ignore/reaping behavior cannot masquerade as kernel fork refusal. No host setting, limit or service is changed. One early development self-check observed `available=false` without retaining the detailed errno and is insufficient to diagnose Root's failure. Subsequent structured self-checks succeeded; Root's window-time os35 cause remains UNKNOWN.

The launcher now includes control processes plus conservative sampler/fork reserve in RSS/thread accounting, caps live long-lived children at 9, and stops on native-probe failure, ordinary fork unavailability, 320 threads with reserve, 2 GiB RSS with reserve or existing output/deadline violations. Permission-denied/racing process-info reads are reported and are not treated as proof of complete UID process visibility.

Self-check observation: 11 kernel threads for the Node test caller; partial native sample took 25 microseconds, full host/process/fork sample took 3,073 microseconds. The full sample reported 1,026 processes, 787 readable current-UID entries, 239 unreadable BSD-info entries and limits 6,000/4,000 with fork and wait both successful. These are preparation-time snapshots, not the first network window's peak values or proof that future process creation will succeed.

## Validation and next gate

- Paced/legacy client, workload bounds, unknown-outcome accounting and fixture tests: PASS in bounded single-process light testing.
- Actual weighted commit/Merkle verification and durable-state tamper controls remain PASS.
- Native helper compiles with `-Wall -Wextra -Werror`; partial/full self-checks and invalid-PID refusal completed without starting nodes.
- Node launcher syntax and prepare-only checks precede any execution.

The next action is a new Root-scheduled 128/256-transaction comparison after the other product builds release resources. Capture the new native process/thread/fork observations as well as offered rate, backlog, effective inclusion, final throughput and P50/P95/P99. A 10-minute 1,000 TPS qualification, higher throughput targets and multi-node crash/restart drills remain outstanding.
