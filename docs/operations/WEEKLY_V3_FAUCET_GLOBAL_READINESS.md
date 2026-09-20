# RPC/Faucet bounded-health and alias readiness checkpoint

Scope: the sole coordinator's second-writer RPC/Faucet assignment on 2026-09-19.
Baseline `8d663d319bb0e74804150485975d96e22baaef75` was clean and remote-exact.
Only the `weekly-v3-network` tree is modified. No Finance/Wallet source, consumer
activation, Mainnet, real securities, chain state, DNS or running service changed.

## Observed runtime, not a deployment claim

Read-only samples at about 12:51 UTC and 13:04 UTC from one local machine:

| Endpoint | First sample | Second sample | Reported identity |
| --- | --- | --- | --- |
| old Faucet `/health` | 200 / 0.930s | 200 / 0.315s | `37fdef1a26436e9731069e9ff2a215f10af276ae` |
| old RPC `/status` | 200 / 0.911s | 200 / 3.436s | `d4857f24735cccc23f2034c110f966ad99273e2f` |
| new RPC `/status` | 404 / 1.881s | 404 / 1.589s | Vercel `DEPLOYMENT_NOT_FOUND` |
| new Faucet `/health` | 404 / 0.371s | 404 / 0.276s | Vercel `DEPLOYMENT_NOT_FOUND` |

Old Faucet reports authoritative mode, upstream `http://127.0.0.1:6420`, chain
6423, YNXT, funding ready, durable requests, 100 default/max and quota 1/address/
hour plus 100/IP/minute. Old metrics report requests 7, successes 5, denied 1;
these are process counters, not a durable audit of all historical requests.
The second local DNS/connection observation reaches `43.153.202.237` for old
hosts and Vercel addresses for the candidates. This is not authority to change DNS
or independent proof of the server binary, proxy configuration or shared DB path.

## Diagnosis and implemented mitigation

Confirmed in the repository object matching the self-reported Faucet SHA:
`CheckHealth` performs serial `/status` and read-only `ynx_getFaucetModel` calls.
Each used the same HTTP client with its own 10-second timeout, without a shared
total deadline or concurrent-probe coalescing. The status body was not bounded.
Thus slow upstream headers/body can occupy each health call for nearly 20 seconds
and concurrent health clients multiply upstream probes. These are reproduced
local failure modes; they do not establish the unique cause of a historic 4.57s
public request.

The matching Core object already limits status cache refresh waiting to 25ms;
the Faucet capability route returns a static network/capability model. The first
Faucet request spent 0.709s of 0.930s through TLS completion. In the second batch,
RPC waited about 2.99s between TLS completion and first byte, while Faucet health
was fast and even the non-probing `/version` took 1.11s. Remote proxy logs,
loopback-vs-public paired timings and service process evidence are needed to
distinguish network/proxy queuing from actual origin delays. No public intermittent
failure was reproduced for old hosts; new-host routing failures are reproducible.

Implemented here:

- Total health deadline, default 2s, bounded configurable maximum 5s, covers both
  upstream stages and response bodies. Funding sends retain existing behavior.
- Overlapping health callers share one probe; disconnecting one caller cannot
  poison another. Completed successes/failures are not cached for later calls.
- Status JSON is capped at 1 MiB, rejects trailing/invalid data, accepts compatible
  additional Core fields, and still checks chain/symbol. Redirects stay rejected.
- Timestamp, overall/status/capability duration and failure stage in health;
  process-local probe/failure/coalescing/readiness/freshness metrics.
- Caddy Faucet templates now explicitly overwrite client `X-Real-IP` from the
  ingress peer. Previously the generic Caddy block did not overwrite that custom
  header, while Faucet trusts loopback proxy peers. Actual deployed proxy type
  and configuration remain unknown; no claim of a verified public exploit.
- Standalone additive Caddy/nginx two-alias candidates, native validation gates,
  same-instance rules, DNS/TLS steps and data-preserving rollback in
  [`deploy/testnet-alias-only`](../../deploy/testnet-alias-only/README.md).

The admission database and funding algorithm are unchanged. Two HTTP aliases
share one writer and one DB. Separate child-process tests prove a live second
writer is refused and a replacement process retains cached receipts and quotas.
This is safe single-writer restart, not horizontal multi-active distributed quota.

## Reproducible local evidence

```sh
go test -race -count=3 -timeout 90s ./internal/faucet ./cmd/ynx-faucetd
go test -race -timeout 90s ./internal/api -run 'Test.*(Faucet|Status)'
node --test scripts/verify/testnet-alias-package.test.mjs scripts/verify/testnet-endpoint-migration-check.test.mjs internal/faucet/web_client.test.mjs
make testnet-endpoint-migration-check chainlist-candidate-check
bash -n scripts/deploy/deploy-testnet.sh
git diff --check
```

All commands passed in the final run. Three race repetitions cover 58 distinct
test/subtest nodes (174 passes including parents); scoped Core covers 31 nodes
including parents. Node covers 50 individual tests. Do not add those parent nodes
to leaf test counts. Coverage includes 48 simultaneous health callers, 40 users
across two aliases, 50 users on one NAT, lost ACK, exact duplicate, conflicting
payload 409, persisted quota 429, upstream header/body deadlines, recovery,
process fencing, stale error clearing and graceful shutdown.

Development failures were corrected before the final run: an initial unused
import prevented build; reusing a strict receipt decoder rejected extensible
Core status fields; a stalled test handler waiting only on an unread POST's
context delayed test-server shutdown. The final bounded fixture and compatibility
decoder pass three race repetitions. These were local development failures, not
observed official/public failures.

## Remaining gates and minimal operator card

1. Supply controlled ingress host/proxy/version/config identity, current service
   binary SHA/PID/upstream/DB path evidence, and matching public/loopback latency
   samples plus proxy upstream timing logs for the slow period. Do not send
   private authority-file contents. Root cause of past public tail latency stays
   unconfirmed until that evidence exists.
2. Separately authorize the exact Faucet binary release, retaining the old binary,
   unit, authority-file reference and DB. Health improvements are not live yet.
3. Separately authorize only the two alias DNS records, target ingress addition,
   TLS certificate issuance and reload. Run the existing proxy's native full
   config validator on the target; neither nginx nor Caddy is installed locally,
   so text tests are not native validation. Keep Explorer and all consumers as-is.
4. After release, obtain regional low-frequency TLS/transport/semantic evidence
   and existing-history/contract readback. Public claim/parallel funding checks
   need their own explicit transaction authorization; none were executed here.

`publicDeployed=false`, `publicVerified=false`, `globalAvailabilityVerified=false`,
`officialSandboxVerified=false`, `productionApproved=false`. Local testing used
temporary fixture chains/accounts only. Recover via a new worktree at the recorded
commit, never resetting another owner's tree. Ingress rollback restores only
backed-up proxy/DNS configuration; binary rollback never resets chain/admission
data. The separate Finance 104-case acceptance remains pinned to its prior exact
Finance/Wallet checkpoints and is not rerun or extended by this network work.
