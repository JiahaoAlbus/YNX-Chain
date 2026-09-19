# Two-host Testnet alias-only operator package

**Candidate, not deployed.** No consumers are switched. Mainnet is disabled.

The sentence above describes these reusable candidate files, not current service
state. The coordinator has since deployed the two aliases using its separately
validated target configuration. Consult the single Weekly v3 handoff and public
receipts; running the package builder or preflight cannot authorize a new change.
`operator-inputs.request.json` is a future-window template, not outstanding inputs
already supplied for the 2026-09-19 deployment. `faucet-cors.env` contains only the
five exact official origins; merge that key without replacing private service env.

Build a checksummed, clean-commit package outside the repository with
`node scripts/deploy/build-testnet-alias-package.mjs --source-commit <full-sha> --output <new-dir>`.
Optional `--with-faucet` creates Linux amd64/arm64 candidates only, never a release.
Run `node scripts/verify/testnet-alias-preflight.mjs --live --origin <public-ipv4>`
for six bounded GET probes. Reachability is separate from state, regional,
consumer and rollback acceptance. Caddy 2.6.2's tagged reverse-proxy parser
supports the existing `lb_retries 0` directive; no syntax migration is needed.
Validate the complete loaded target config before any authorized reload.
This is an additive ingress package, not a chain/service installer. Keep the old
RPC/EVM/Faucet hosts, Core binaries/state, genesis, validators, funding account,
Faucet admission DB and indexes unchanged. Explorer is deliberately not activated.
Do not run `scripts/deploy/deploy-testnet.sh` to install these two aliases.

## Minimal external authority and information

The authorized operator must provide the existing ingress host and proxy type,
its exact loaded config/include paths and version, its current config checksum,
certificate method, and the DNS record IDs/old values for **only**
`rpc-testnet.ynxweb4.com` and `faucet-testnet.ynxweb4.com`. No secrets go in chat.
The currently observed Vercel 404 is not a usable RPC deployment. Point those two
names to the controlled existing ingress; do not modify wildcard/old-host records.
Use TTL 300 during the approved change. Check A, AAAA and CNAME separately: do not
leave an AAAA route pointing elsewhere. Do not guess the destination IP from a
Core peer/primary field. It must be confirmed by the service/ingress owner.

## Preflight and preservation (on the approved host)

1. Save DNS old values/TTL, proxy config plus include inventory, service unit
   identity and binary SHA-256 to a private timestamped rollback directory.
   Record Faucet `/version`, `/health`, RPC `/status`, and loopback equivalents.
   Confirm chain ID 6423 / YNXT and old host routing. Record the **actual**
   configured admission path (default is request-log + `.admissions.db`).
2. Verify 6420 and 6428 are the SAME existing upstreams as legacy hosts. Ensure
   port 6428 is loopback-only. Both aliases must use that one Faucet process and
   its one durable DB, never a copied DB or regional independent Faucet.
   bbolt rejects a second writer on the same local DB; it is not a distributed
   database. Do not put it on NFS or build multi-active Faucet replicas.
3. Verify no duplicate candidate hostname blocks. Choose only the proxy already
   in service. If a CDN/proxy is in front, stop and get a reviewed trusted-IP
   chain: templates assume direct client-to-ingress. Never trust incoming
   `X-Real-IP` blindly. Caddy overwrites it with `{remote_host}`; nginx uses
   `$remote_addr`. Review legacy Faucet's matching overwrite too, so both hosts
   charge the same client IP policy. Do not replace old config wholesale.

## Install candidate and validate, then reload only with approval

- **Caddy:** copy `aliases.caddy` to a new exact path such as
  `/etc/caddy/ynx-testnet-aliases.caddy`. Add one explicit top-level import to the
  existing backed-up Caddyfile (unless its existing include already loads it).
  `caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile --validate`
  must pass for the complete configuration before `caddy reload --config
  /etc/caddy/Caddyfile --adapter caddyfile`. Caddy's automatic HTTPS will need
  approved DNS plus inbound 80/443 and successful certificate issuance. Adapt
  success alone is not live TLS evidence.
- **nginx:** issue the two host certificates using the existing approved ACME
  workflow first; no private keys belong in the package. Inspect the paths in
  `aliases.nginx.conf`, install as a new include in the existing `http` context,
  run `nginx -t`, then the service owner's `systemctl reload nginx`. Do not use
  a full config replacement or start nginx if Caddy currently owns 443.
  IPv6 listeners/records require separately verified ingress support. The file
  deliberately does not invent an HTTP redirect or replace legacy port 80 routes.

No proxy or TLS binary is installed by this package. Native full-config validation
on the target proxy/version/certificates is a mandatory external gate, not a
claim made by text fixture tests. Templates preserve paths, JSON-RPC POST bodies
and upstream CORS; no request rewrite, response cache or automatic write retry.
WebSocket forwarding can preserve an existing route but does not prove that
Core exposes one; gRPC/WS acceptance remains separately scoped.

## Verify and keep consumer activation off

Before DNS, use bounded `curl --resolve <candidate>:443:<approved-ingress-IP>`
checks with normal TLS validation; never `-k`. After DNS, run the existing
read-only comparison from `docs/operations/TESTNET_ENDPOINT_MIGRATION.md` with
approved existing transaction/contract samples. Check both legacy hosts again.
Obtain same block/hash/history/balance/code, CORS and native RPC evidence. Obtain
the target-host upstream/PID/config/DB identity evidence; matching `/health`
fields alone do not prove shared quota. Public claim/concurrency testing requires
separate explicit transfer authorization and is NOT included in this operation.

Read-only regional probes should record region, DNS/connect/TLS/TTFB/total,
HTTP status, body identity and UTC timestamp at low frequency. One laptop's
curl or a local 48-user fixture is not global availability. Keep all migration
activation/public verification flags false pending these independent gates.

## Exact rollback scope

If validation fails, do not reload. If post-reload checks fail: restore the
backed-up Caddyfile/import or nginx include and move only the newly installed
alias file into the private rollback directory (retain for diagnosis), validate
the full old config, reload the same proxy, and restore the two saved DNS records
and TTLs. Verify old RPC/Faucet again. Never restore/delete/rewind chain or
admission data for an ingress rollback; no database migration is involved.

The health binary fix is a **separate** owner-approved service release: preserve
the existing binary + unit and stop/drain only `ynx-faucetd`, leaving Core up.
Retain the same DB path and private authority-file reference, install the exact
reviewed binary, start one instance and verify. Roll back only that binary/unit
if needed. Never run two Faucet writers or copy/delete the DB to bypass its lock.

## Monitoring after separately authorized release

`/health` stays uncached and truthful: default total probe budget 2 seconds,
maximum configurable 5 seconds via newly implemented
`YNX_FAUCET_HEALTH_TIMEOUT` / `--health-timeout`. Failed health remains HTTP 502.
Inspect `checkedAt`, `probeDurationMs`, `statusDurationMs`,
`capabilityDurationMs`, `probeFailureStage`; do not auto-restart Core for a
temporary health failure. `/metrics` exposes process-local probe/failure/join
counters, last readiness, timestamp and duration; it does not run a probe.
Alert on readiness 0, stale/no checked timestamp (e.g. >60s with a 15s health
scrape), repeated deadline failures, and latency by region. Counters reset after
process restart and are not durable admission totals. Do not expose private
authority files or client request logs to monitoring dashboards.

References checked for template semantics:
[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[Caddy placeholders/imports](https://caddyserver.com/docs/caddyfile/concepts),
[nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).
