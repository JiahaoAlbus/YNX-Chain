# Weekly v3 transport: executable monitoring and operator handoff

## What is implemented, and what is not

Baseline: `885226113b7c10dddc9504c42f87c3918684ca86`. Only NETWORK diagnostic
scripts/tests/docs change. No Wallet/Finance source, chain/admission state, DNS,
proxy/firewall configuration, service restart/reload or device installation changes.
No Faucet POST or transaction submission. Existing public aliases remain intact.

This package provides a scheduler-safe **one-shot** job, persistent transition
alerts, staleness check, origin/DNS comparison and one-command allowlist-redacted
JSON diagnostic bundle. It does **not** install/enable a scheduler, notification
destination, new cloud runner or old Codex automation. Operator scheduling and
alert delivery remain distinct deployment gates. No production fix is claimed.

## Run one bounded batch

Run from the NETWORK checkout with Node/curl already available. The job command
is also independent of the caller's working directory when invoked by absolute
script path. Use a **dedicated new absolute directory**, with private parent.
Existing state directories must be owned by the caller and mode 0700; broad home,
filesystem root and current checkout paths are rejected. No auto-chmod or cleanup.

```sh
node scripts/verify/testnet-transport-job.mjs
node scripts/verify/testnet-transport-job.mjs --live \
  --state-dir /private/tmp/ynx-transport-normal-UNIQUE \
  --vantage macos-owner --direct
```

First command is dry: no network/files. Second performs exactly eight GETs: two
rounds of four old/new RPC/Faucet health routes, two concurrent requests maximum,
30-second interval, no redirects or retries, normal TLS. Each request retains
5-second connection / 8-second total / 1-MiB response limits. The job wrapper has
a 240-second child-process deadline. Failures remain in raw private observations;
the job does not resubmit to make a batch green.

Optional existing-host diagnostics (read-only, no remote installation):

```sh
node scripts/verify/testnet-transport-job.mjs --live \
  --state-dir /private/tmp/ynx-transport-host-UNIQUE \
  --vantage macos-owner --direct \
  --host ubuntu@43.153.202.237 \
  --identity /Users/huangjiahao/Downloads/Huang.pem \
  --known-hosts /Users/huangjiahao/.ssh/known_hosts
```

The identity is passed opaquely to strict-host-checking SSH. No key contents are
read. Host windows include queue/drop counters; first/last windows read filtered
Caddy configuration, service state, conntrack count/cap and nftables projections.
`nft -j list ruleset` is read-only. Output omits rule names, addresses, comments
and expressions. Missing permission/tool/JSON/counter is **unknown**, not zero.
Only nft rules are visible: legacy iptables, cloud security groups, NAT mappings
and upstream provider filtering are not thereby excluded. A dport443 marker does
not retain complete match semantics or establish a causal rule. No firewall write
or counter reset occurs. Packet capture remains manual/opt-in on the original
monitor; the scheduled job deliberately has no packet-capture option.

## DNS/origin comparison and independent-vantage gate

On the same machine, in a **different state directory**, run:

```sh
node scripts/verify/testnet-transport-job.mjs --live \
  --state-dir /private/tmp/ynx-transport-pinned-UNIQUE \
  --vantage macos-owner --pin-origin
```

`--direct` disables curl environment proxies for that process. `--pin-origin`
also pins only the four allowlisted hostnames to the already authorized public IP
43.153.202.237 while retaining their original URL, Host/SNI and certificate
verification. Pinned readiness additionally requires that actual remote IP and
proxy metadata match the direct target. It is not a DNS change. The separately
sampled DNS result remains diagnostic, not proof of curl's resolver path.

Normal versus pinned requests from one machine are a controlled DNS/proxy
comparison, **not independent regions**. A VPN/system tunnel can still be shared.
The monitor now automatically projects the local route to the approved IP: macOS
route/interface MTU and proxy enable flags, or Linux `ip` route/link metadata.
It retains no gateway/interface address, interface number, proxy server or PAC
URL, and never changes routes or disables a VPN. Each local command is bounded
to three seconds. Missing tools leave unknown fields, not a direct-path claim.
On 2026-09-19 17:32 UTC this Mac's route used a **utun interface, MTU1100**, while
system/environment proxy flags were off. Both normal/direct DNS and pinned-IP
requests therefore still shared a tunnel. This is an environment observation,
not proof that this tunnel caused the failures or authorization to bypass it.
Operator must supply a second authorized existing runner on a different verified
egress path and region to obtain independent-path evidence. Run the same bounded
command there with a distinct public non-sensitive vantage label and private
state directory. Record operator-confirmed egress/region in private deployment
inventory; a different label alone is not proof. Never turn these two scopes into
one state file. Compare timestamped redacted bundles side-by-side and preserve
both failures and successes. Do not enroll a paid runner or change networking
without authorization. An external web-fetch tool could not access the two
canonical health URLs in this round; this is a tool limitation, not a measured
second-region service failure or success.

## Scheduler and notification integration contract

An authorized operator may invoke the one-shot command every **five minutes**
using their approved existing scheduler; do not activate anything just by reading
this runbook. Do not resume old ecosystem automation prompts. Each identity needs
its own state directory. The exclusive `.run.lock` forbids overlap. A completed
batch must be at least 60 seconds old before another begins. Persistent state is
written through an fsynced exclusive temporary file and atomic rename; each run
keeps `previous-state.json` for recovery. Files are mode0600, directories0700.

The job emits one JSON result to stdout, stores `alert.json` and
`diagnostic-bundle.json` beside raw `observations.jsonl`/`summary.json`, and uses:

| Exit | Meaning | Operator action |
| --- | --- | --- |
| 0 | Batch evaluated with no open incident/gap | Keep records; not global acceptance |
| 2 | Open incident, requested host-evidence gap, or stale status | Inspect JSON; notify only if `alert.notify` is true |
| 3 | Job/config/lock/storage/artifact error | Inspect private state safely; do not treat as recovery |

No webhook, email, chat or secret-bearing notification destination is configured
by this package. A deployment must bridge `alert.notify=true` to its authorized
channel; an unchanged incident can still exit2 with `alert.notify=false`. Avoid
schedulers that send an email on every nonzero run if silence-on-unchanged is
required. Scheduler execution failures and a missing heartbeat need their own
external watchdog; a job that never runs cannot alert on its own absence.

```sh
node scripts/verify/testnet-transport-job.mjs --status \
  --state-dir /private/tmp/ynx-transport-normal-UNIQUE
```

This command reads only; absent, future or older-than-20-minute state reports
`monitor-stale`. It does not probe, repair or refresh timestamps.

### Alert semantics

- Any failed endpoint batch opens a warning; two consecutive failed batches for
  that endpoint escalate to critical. A service identity/readiness or certificate
  verification failure is immediately critical. A TLS **timeout** is not silently
  reclassified as a certificate fault.
- Once open, the incident persists through one or two healthy batches. Three
  distinct healthy batches, with the minimum time separation, clear it as
  `recovered-samples`; this does not prove sustained or global availability.
- Repeated unchanged incidents are quiet. Meaningful phase/severity changes and
  cleared incidents notify. Missing/incomplete promised observations produce a
  diagnostic gap, not healthy evidence. Duplicate/older/future/stale batches,
  identity mismatch and changed source/policy cannot manufacture a recovery streak.
- Changing source/policy or a gap of over20 minutes resets recovery accumulation.
  No prior raw failures are overwritten. State thresholds count **batches**, not
  several requests within one batch as several independent periods.
- Global readiness, continuous availability, independent network path and root
  cause booleans remain false regardless of alert state.

## One-command shareable diagnostic bundle

Each job automatically creates an inspectable JSON bundle. To export an earlier
private monitor run, including a manually collected packet-metadata run:

```sh
node scripts/verify/testnet-transport-bundle.mjs \
  --input-dir /private/tmp/EXACT-EXISTING-RUN \
  --output /private/tmp/NEW-SHAREABLE-BUNDLE.json
```

The exporter validates observations against the summary's SHA-256, run identity,
allowlisted routes, round uniqueness and bounds. It rejects symlink/hardlink files,
oversized or malformed input and never overwrites output. It rebuilds the package
from allowed fields only: phase values, public endpoints, expected-origin boolean,
chain/build identity, counters, queue sizes, bounded packet sequence/ACK metadata.
It removes raw errors/headers/bodies/config/logs, paths, all client addresses **and
their hashes**, unrecognized fields and secrets hidden in nested metadata. Hashes
provide artifact integrity, not authentication of a remote runner. Operators must
review the bundle before authorized sharing; no upload happens automatically.

Storage is capped at 128MiB / 2,048 files with 20MiB reserved before starting a
new batch. Symlinks/nonregular files and excessive directory depth fail closed.
The tool never prunes history. At the cap, archive an explicitly selected run set
under the retention policy, verify archive hashes and obtain deletion authority;
do not delete the state root or broad directories. A stale lock is never stolen:
read its private `owner.json`, verify PID/start time and no active job, preserve
crash artifacts, then remove **only that proven stale lock** under operator control.

## Minimal repair decision and rollback gates

No current evidence identifies a configuration defect requiring a live edit.
Do not restart to mask the issue, widen firewall access, increase connection
timeouts/retries to relabel failures, alter MTU/TLS/ciphers, cut DNS or change proxy
routes solely because a short later sample passes.

1. **Collect before changing.** Preserve exact run/bundle hashes, UTC interval,
   alias/phase and current Caddyfile hash, PIDs and drop/conntrack counters. Obtain
   authorized independent egress samples and cloud flow/drop logs where possible.
2. **If a host rule is suspected:** operator inspects the full local rule privately
   and correlates exact interface/direction/flow/counter increment. Aggregate nft
   counters alone do not justify changing a rule. If no rule/limit is causal,
   leave host config unchanged and escalate the redacted evidence to the network
   owner through an approved channel.
3. **Before one verified-rule/config repair:** require explicit owner authority,
   an out-of-band console, exact live configuration backup + checksum, review of
   the smallest scoped change, syntax validation and a tested exact restoration
   command. Without these, this package's action is diagnostics only. Do not flush
   tables, reset counters, disable a firewall or restart any service.
4. **After an authorized repair:** run the same normal/pinned/independent-vantage
   probes at the same budgets; compare failures and immutable source/runtime
   identity. Preserve old aliases and all chain/admission files. Only call the
   change effective after its predefined sampling criterion, not one healthy GET.
5. **Rollback:** restore only the backed-up changed rule/config by the authorized
   owner's tested restoration step. If no production change was made (this round),
   no service rollback is needed. Disable only a newly authorized diagnostic
   schedule if necessary, retain state/evidence, or review a scoped revert of this
   additive source package. Never reset a shared worktree or overwrite other owners.

Concrete firewall/DNS/proxy mutation commands are intentionally not guessed: the
causal target and fresh deployment/rollback authority are not established.

## Reproducible checks and references

```sh
node --test scripts/verify/testnet-transport-operations.test.mjs \
  scripts/verify/testnet-transport-monitor.test.mjs \
  scripts/verify/testnet-alias-preflight.test.mjs \
  scripts/verify/testnet-endpoint-migration-check.test.mjs
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 scripts/verify/testnet-transport-host-snapshot.test.py
node scripts/verify/weekly-v3-native-android-evidence-check.mjs
git diff --check
```

Semantics were checked against [curl's official manual](https://curl.se/docs/manpage.html#--resolve)
and the [nftables official manual](https://netfilter.org/projects/nftables/manpage.html).
The prior [diagnostic runbook](WEEKLY_V3_TRANSPORT_DIAGNOSTICS.md) records exact
earlier failures and phase-classifier corrections. The current single coordinator
handoff remains `WEEKLY_V3_HANDOFF.md`; this is not a competing coordination file.
