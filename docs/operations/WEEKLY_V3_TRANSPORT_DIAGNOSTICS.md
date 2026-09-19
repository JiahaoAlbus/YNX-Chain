# Weekly v3: bounded Testnet transport diagnostics

## Scope and acceptance

This is the NETWORK owner's read-only diagnostic tool, not a production
configuration change or a new ecosystem goal. It preserves the old and canonical
RPC/Faucet aliases, chain 6423, chain state, Faucet admission state and all services.
No claims, retries of claims, account requests, signatures or transactions occur.
No restart/reload, sysctl change, TLS bypass or credentials read occurs.

The sole coordinator remains task `01a094cc-0ba3-7901-bcd5-56fce8330c0d`.
Only `WEEKLY_V3_HANDOFF.md` in its coordination directory is the current handoff.
This document is a reproducible diagnostic runbook, not another coordination file.

`allSamplesHealthy` describes only the sampled external GETs. Server observation
availability and timestamp coverage are reported independently in `hostWindows`.
The tool never promotes `rootCauseConfirmed`, `continuousAvailabilityVerified` or
`globalRegionalVerified`. A successful later sample does not erase earlier failures.
Local tests are not official Broker Sandbox or installed Wallet acceptance.

## Execution

Requirements: Node.js with ESM, curl supporting `%{json}`, optionally SSH and the
existing authorized Ubuntu host's Python 3, ss, systemctl, journalctl and Caddy.
No dependency installation, remote file writes or resident process is required.
Test the collector locally with a functioning Python interpreter; on this owner
machine `/usr/bin/python3` works while the separate framework Python was killed.

Dry run (no network and no output directory):

```sh
node scripts/verify/testnet-transport-monitor.mjs
```

Bounded external run (choose a **new absolute** private output directory each time):

```sh
node scripts/verify/testnet-transport-monitor.mjs --live \
  --rounds 4 --interval-seconds 35 --vantage macos-owner \
  --output-dir /private/tmp/ynx-transport-UNIQUE-RUN
```

For failure-concurrent host sampling, append the following using the already
authorized SSH identity; it is passed opaquely to SSH, never read by the tool:

```sh
--host ubuntu@43.153.202.237 \
--identity /Users/huangjiahao/Downloads/Huang.pem \
--known-hosts /Users/huangjiahao/.ssh/known_hosts
```

Optional `--packet-metadata` starts one 25-second/120-packet header-only capture
per round. Four randomly allocated distinct client source ports narrow the
capture. It uses no `-A`, `-X` or packet-file output; only direction, time, port,
flags, sequence/ACK, payload length and a client-address hash leave the host.
Payload bytes, raw packet text and raw client addresses are not retained.
The collector parses IPv4 only, consistent with the observed current A-only
aliases; future AAAA/IPv6 use requires extending and validating this collector.

The host-ready signal means the sampler process started, not that tcpdump has
confirmed its listener. Capture success is reported after completion. SSH and
HTTPS egress IPs can differ; matching local source ports is still **not proof** of
flow identity because NAT can rewrite ports and another client can collide.
No captured packet does not prove no packet reached the host. Correlation requires
timestamps, ports, address hashes, sequence/ACK progression and coverage together.
Do not infer TLS content or certificate errors from packet length alone.

## Bounds and artifacts

- Exactly four allowlisted GETs per round; two concurrent clients, no retry,
  redirects, TLS bypass or alternative endpoints. curl config files are disabled.
- curl connection deadline 5 seconds, whole request 8 seconds, response cap 1 MiB;
  subprocess deadline 10 seconds. DNS is a separate child bounded to 2.5 seconds.
- 1–120 rounds, interval 15–300 seconds, scheduled window at most two hours.
  Slow host collection can extend wall-clock duration; rounds never overlap.
  SSH has a 10-second connection deadline and collector wrapper an 80-second cap.
  SIGINT/SIGTERM prevents new work; an in-flight bounded call or scheduled sleep
  can finish before the summary is written (sleep at most 300 seconds).
- Host snapshots: eight at three-second intervals, filtered socket/listener state
  and host-wide TCP counters. First/last rounds also read configuration projections,
  service PIDs/restart counters, sysctls, journal category counts and local health.
  These detailed loopback probes run **after** the counter window, not at the exact
  instant of every external failure. Full config, logs, environment and keys never
  leave the host. Clock skew is not corrected; coverage is timestamp correlation.
- Output leaf directory is exclusively created mode 0700. `observations.jsonl`
  and `summary.json` are exclusive mode 0600; events are fsynced. Summary binds the
  observations SHA-256. Start event hashes both collectors and the shared health
  interpreter. Existing output is never overwritten. No automatic cleanup.
- Exit 0: all scheduled external samples healthy. Exit 2: failure/interruption.
  Host evidence may still be unavailable with exit 0; check `hostWindows` separately.
  CLI/filesystem/process errors can also exit nonzero. Missing evidence is not zero.

For longer-term use, run bounded batches under a separately scoped, authorized
monitor. Do not resume old ecosystem automations or introduce an unmanaged daemon.
Keep raw diagnostic storage bounded operationally (review at 128 MiB); archive
sanitized material evidence and delete nothing without retention authority.

## Phase interpretation and known instrumentation corrections

| Evidence | Reported phase | Does not establish |
| --- | --- | --- |
| curl 6 | DNS failure | Which resolver/network hop failed |
| curl 28; no completed name lookup | DNS/connect unresolved | A proven DNS outage |
| curl 28; lookup done, TCP incomplete | TCP connection timeout | Client ISP vs cloud firewall vs host |
| curl 28; TCP done, TLS incomplete | TLS handshake timeout | Bad certificate, Caddy fault, or packet-loss hop |
| curl 28; TLS done, no first byte | HTTP first-byte timeout | Caddy vs application without correlated evidence |
| curl 60/51/77/83 | TLS verification failure | That all handshake timeouts share this cause |
| HTTP 5xx | Server/upstream response | Which upstream or code path failed |
| HTTP 200, wrong identity/readiness | Service validation failure | Successful Testnet readiness |

curl's connection deadline includes DNS, TCP and TLS. `time_connect` and
`time_appconnect` distinguish completed stages, not packet-level root causes.
An incomplete TLS handshake can report `ssl_verify_result=1` alongside curl 28;
the timeout takes precedence. Earlier development runs incorrectly labelled this
as verification failure; their raw results are preserved, with corrected analysis
separate. A prior derived body-duration calculation on no-first-byte timeouts was
also corrected to `null`; original raw timing values remain authoritative.

The independent DNS snapshot is not proof of curl's resolver path. Host-wide
retransmission/timeout increments are not per-request loss. Counter resets yield
unknown deltas, never negative loss or zero. Caddy access logging is not enabled
in the inspected configuration. Caddy 2.6.2 sends the Go HTTP server error logger
to debug level; empty normal-level journals cannot exclude TLS faults.

## Findings and repair threshold

Development runs on 2026-09-19 UTC reproduced failures with DNS resolving to
43.153.202.237, both before TCP completion and after TCP but before TLS completion.
Some later samples succeeded. Separate standalone curl also reproduced a TCP
timeout, so this is not based solely on the new monitor's classification.

Observed host windows had no growth in ListenDrops/ListenOverflows/BacklogDrop or
request-queue drops, listeners showed receive queue 0/backlog 4096, and subsequent
normal-TLS loopback and direct upstream health requests were healthy. Caddy 2.6.2
had no sampled restart, no explicit custom read/header/write timeout or cipher
restriction in its loaded/disk configuration, and no demonstrated resource limit.
Omitted configuration fields mean defaults, not misconfiguration. The exact
per-run values and final collector identity belong to the committed evidence.

No evidence-backed production fix is justified yet. Do not increase retries,
change MTU/TLS/ciphers/backlogs, upgrade/restart Caddy or claim recovery merely
because a subsequent sample passes. Remaining gaps: independent regional external
vantages; NAT-preserved per-flow attribution; failing-hop/cloud network/ISP flow
evidence; and request-level observability when a failure reaches HTTP. Loopback is
not a second region. Access logs cannot by themselves explain pre-HTTP failures.

## Tests and recovery

Final collector source checkpoint:
`87a10901ed8942c2498e33c17c8be19d764694c6`, tree
`fae25d1559f5585c422bc8e57196426e17895e7e`. Its three-round public run on
2026-09-19 16:20–16:21 UTC returned **9/12 healthy, 3 TLS handshake timeouts**.
All three host windows cover their client windows (uncorrected-clock caveat).
The failed ports have prompt server data responses (~0.61–0.66 ms after inbound
data), repeated outbound sequence ranges and incomplete ACK progression. This
is stronger delivery-path evidence, not proof of which network hop failed.

The three development runs plus final source run contain 48 GETs: 24 healthy,
17 TCP connection timeouts and 7 TLS handshake timeouts after correcting the
development classifier. This is **not an uptime estimate** or regional sample.
Raw classifier labels are retained in the development archives, and correction
records are separate. All 80 Node tests and 5 Python tests passed. Final-loopback
checks passed 8 normal-TLS and 4 direct-upstream reads; configuration hash and
service PIDs/restart counts stayed unchanged. No production fix was applied.

See `release/evidence/weekly-v3-transport-diagnosis-20260919.json` for the exact
source hashes, archive hashes, all failure correlations, limitations and recovery
checkpoint. Four adjacent sanitized archive files preserve the original timings
and sampled host evidence. Private raw files remain in their receipt-listed paths.

```sh
node --test scripts/verify/testnet-transport-monitor.test.mjs \
  scripts/verify/testnet-alias-preflight.test.mjs \
  scripts/verify/testnet-endpoint-migration-check.test.mjs
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 scripts/verify/testnet-transport-host-snapshot.test.py
git diff --check
```

The prior source checkpoint is `b82a540122a414523b65ce96b1641a399224b246`,
tree `1738b8e77f0dc2494b54595e198b6cd106d96d1e`. All changes in this package are
additive diagnostic files. Recovery means stop invoking the collector or revert
only its reviewed commit in the NETWORK branch; never reset the worktree, delete
evidence, replace another owner's dirty files, restart services or restore chain
data. There is no production deployment to roll back for this package.

## Primary references

- [curl connection timeout and timing semantics](https://curl.se/docs/manpage.html#--connect-timeout)
- [Caddy global HTTP server options](https://caddyserver.com/docs/caddyfile/options)
- [Exact Caddy 2.6.2 HTTP application/logger source](https://github.com/caddyserver/caddy/blob/v2.6.2/modules/caddyhttp/app.go)
- [Exact Caddy 2.6.2 server defaults](https://github.com/caddyserver/caddy/blob/v2.6.2/modules/caddyhttp/server.go)
- [Linux IP/TCP sysctl reference](https://docs.kernel.org/networking/ip-sysctl.html)
