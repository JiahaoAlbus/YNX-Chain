# Exchange public runtime deployment lease request

**Request state:** `PENDING_CENTRAL_SINGLE_USE_LEASE`  
**Scope:** Exchange only (`apps/exchange/**` and the archive below)  
**Authorization:** none. This is a source-bound candidate and request, not a production deployment, public-runtime proof, or wallet-lifecycle result.

## Immutable Linux amd64 candidate

| Field | Exact value |
| --- | --- |
| source commit | `6edfe066a30be91618c7d36a63b1029a740c3dd2` |
| source tree | `d6e10ecbac3ee62fdb44103bb5270cb7edb081ef` |
| runtime archive | `apps/exchange/evidence/release-candidates/ynx-exchange-6edfe066a30b-runtime.tar.gz` |
| archive bytes | `4133472` |
| archive SHA-256 | `896f3b2f4129d0209ea5a6ad2a124bca297c8257c757137cd699785a643dd7c7` |
| archive root | `ynx-exchange-6edfe066a30b` |
| Linux amd64 executable | `ynx-exchanged` |
| executable bytes | `7516308` |
| executable SHA-256 | `45fd389542d28006f465125d9f498b0cf9ac4ce55ef7f925e47b8e49c317373e` |
| served entry asset | `apps/exchange/web/index.html` |
| entry asset SHA-256 | `83d949bf3905518c4884590ea4d0fd943f59fd0a3db86cfca1e37f9f3ca11437` |
| provider bundle | `apps/exchange/web/wallet-connect.js` |
| provider bundle SHA-256 | `a870c591d23c50a6ea2f7eb15f3bf6362c4b83b867b4b5e936b28e18fd42cc34` |
| Provider/connect-state vendor source | `98c6d5d784d212df8981a53b17118a511e246ad2` / tree `51a60a362d4ad5dd748bcdefb101f71b1d9e0cee` |
| provider vendor tarball SHA-256 | `115f775cae49b124c882cb9ac4103c52da6bb1b64a91062b45f8e8e6ab949eb2` |

The archive contains exactly the Linux executable, tracked served Web assets, both vendored wallet packages, and the tracked Exchange systemd/Caddy/env templates. It deliberately excludes `node_modules`, source maps, local state, secrets, and generated host configuration.

## Reproducibility checks completed against the exact source

- `npm ci --prefix apps/exchange`; `npm ci --prefix apps/exchange/web`
- `npm run verify:wallet --prefix apps/exchange/web`
- `npm test --prefix apps/exchange` — 12/12 pass
- `go test ./apps/exchange/server ./internal/exchangeproduct` — pass
- deterministic build: `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o ynx-exchanged ./apps/exchange/server`

## Dynamic bindings required in a future signed lease

Central must freshly read and sign, immediately before execution:

1. target host architecture, service unit, `ExecStart`, `WorkingDirectory`, env path, Caddy route, state path, active release location, symlink behaviour, and their byte hashes;
2. current executable and served Web asset inventory; exact current public `/`, `/version`, `/health`, and `/api/health` URL/status/bytes/body SHA-256/source identity responses; and
3. immutable candidate stage directory, same-filesystem backup directory, new release directory, full preflight/deploy/rollback/public-verifier command bytes and SHA-256, and before/after service/configuration/public receipts.

The checked-in unit template is a deployment clue only (`/opt/ynx/exchange`, `/usr/local/bin/ynx-exchanged`, `/etc/ynx/exchange.env`, Caddy `127.0.0.1:18446`); it is not a fresh production binding. A signed lease must fail closed on any mismatch and may mutate only Exchange-owned runtime targets. The release must bind the server binary plus served asset hashes; a successful static page alone is insufficient.

## Required post-deployment evidence, still absent

Router gate `875be208e8a7ddb60345d55b93fc299949664e5c` requires direct source-bound public or installed evidence. None has been collected here. In particular, no real provider selection, account approval/rejection, `0x1917` switch/add/readback, refresh/events/disconnect/revoke, callback, WalletConnect lifecycle, signature, or Testnet trade is asserted.

All of `deployedPublic`, `sourceBoundPublicRuntime`, `providerApproved`, `walletCallback`, `installed`, `order`, `trade`, `ProductSession`, `ComputerControl`, `productsConnected`, and `migratedV2` remain false.
