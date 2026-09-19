# Weekly v3 network and integration checkpoint

## Scope and runtime boundary

Source owner: `codex/weekly-v3-network-20260919`, isolated from the dirty main checkout. Finance and Wallet product implementations remain in their owner trees. No public endpoint is activated by this package; no external credentials, DNS updates, process restarts, signatures, funding requests or securities orders are performed by the local gate.

The migration manifest generates `configs/testnet-endpoints.json` and `sdk/js/testnet-endpoints.js`. The SDK exports immutable typed profiles and an active/legacy selector. Candidates are visible for deliberate read-only verification, but cannot be selected as an active consumer configuration. There is no Mainnet/live selector. The Mainnet draft in `configs/networks.json` now has `enabled=false`, `chainId=null` and a reserved hostname without a currency/genesis assignment.

## Consumer inventory and migration decision

| Consumer | Verified source/interface | This package's action |
| --- | --- | --- |
| JavaScript SDK and examples | `sdk/js/index.js`, generated `ynx-testnet.js`, `sdk/examples` | Add typed generated profile export and example; preserve existing constructor and EIP-1193 payloads |
| Python SDK / developer read-only proof | `sdk/python/ynx_client.py`, `scripts/verify/sdk-remote-check.sh` | Preserve Python API; feed both SDKs separate native-REST/EVM defaults from the shared profile |
| Ops remote smoke configuration | `scripts/verify/remote-smoke-test.{sh,mjs}` | Resolve RPC/Faucet/Explorer defaults from the profile; retain explicit operator overrides and distinct REST/gRPC; do not run this broad remote mutation-capable suite for Weekly v3 |
| Faucet | `internal/faucet/server.go`, deployment ingress configuration | Keep old and candidate origins; exercise shared admission state and per-recipient/IP policy through two isolated HTTP listeners |
| Explorer / deployed service configuration | `scripts/deploy/deploy-testnet.sh`, `infra/docker/docker-compose.yml` | Preserve existing upstream/process/data and old public defaults; alias-only ingress deployment needs separate controlled authority |
| Wallet owner `ab4dfa927be3d16fde3048b72d705d90c770dcd3` | `apps/wallet-web/src/{extension-rpc,extension-manifest,provider}.js`, `packages/wallet-auth/src/metamask-evm-adapter.js` | Keep EVM URL, exact-response origin and CSP consistent on old host. Run existing network/provider/Faucet tests; do not edit owner code or rotate queued-transaction RPC provenance |
| Finance owner interface | `apps/finance/mobile/contract/public-endpoint-manifest.json`, `mobile/src/endpoint-manifest.ts`, `scripts/probe-accepted-connectivity.mjs` | Keep accepted manifest and Product Session authority; do not replace its integrity hash, private API origin or Broker endpoint with the chain alias. Integrate only a completed owner checkpoint |
| Shop, Seller, Monitor and AI in this network baseline | Tracked application source/config inspection found no literal references to the migrated public hosts outside excluded artifacts/evidence | No speculative hostname rewrite. Their current authoritative deployment trees require recheck at public activation; paused product goals remain paused |
| CI/CD | `.github/workflows/testnet-endpoints.yml` | Add isolated configuration, RPC fixtures, Faucet race and SDK compatibility checks, without secrets or deployment steps |

Historical evidence, pinned release artifacts, integrity manifests and previously submitted chain-list records are not mass-rewritten. The template repository is not evidence of every installed/public consumer's current source. New alias health alone never authorizes a release rebuild or updates a signed/pinned consumer manifest.

## Reproducible local gate

```sh
make weekly-v3-local-check
node scripts/verify/weekly-v3-local-check.mjs \
  --wallet-worktree '/Users/huangjiahao/.codex/worktrees/6efe/YNX Chain' \
  --wallet-commit ab4dfa927be3d16fde3048b72d705d90c770dcd3
```

Optional `--output <new-file>` persists the JSON result and refuses to overwrite an existing file. The Wallet checkout must match the exact provided HEAD and its tested source must be committed; the unrelated pre-existing Wallet packaging artifact is not changed. Output records checkpoint identities, source dirty status, individual commands' success, output digests, tails and remaining gates. Full Finance→Wallet→provider→status→reconciliation acceptance stays false until tested against the completed Finance implementation; concatenating two owners' unit tests is not cross-product E2E.

Observed local results before the final checkpoint: 38 endpoint/profile fixtures; Faucet/core race tests including 40 concurrent users across two aliases and cold lost-ACK recovery; SDK 16 JS + 6 Python tests and deterministic clean-package tests; Wallet 19 approval/transport + 67 extension/provider/network + 142 approval-lifecycle/authority-time/Faucet recovery tests, all passed. These counts are fixture/regression coverage, not official Sandbox, browser-installed Wallet or public alias proof.

The repository-wide GitHub Actions pin check remains failing on seven pre-existing tag references in `mail-ci.yml` and `mail-calendar-ios-proof.yml`, also present at `baab2a4e`. This network change does not modify those out-of-scope Mail workflows. The added endpoint workflow uses only the existing repository's full 40-character commit pins. No remote CI run has been claimed.

Live read-only check on 2026-09-19 around 09:39 UTC: JavaScript SDK read legacy REST/EVM heights 1629027/1629028 and Python read 1629028/1629029, both chain `0x1917`, release `core-ecosystem-20260912`. The first attempt encountered a killed host `python3` interpreter; the remote wrapper now uses the same explicit/system-interpreter policy as the local SDK gate, and the rerun passed both clients. No public write was sent. The candidate `rpc-testnet` check still returned HTTP 404 before any acceptance proof, so all candidate-public flags remain false.

## Remaining activation and integration gates

1. Complete Finance owner delivery and then run the real local application path: draft, approve/reject, one-time consume, provider request, status, cancel race, event/restart reconciliation. Include atomic signed-revoke vs consume, all unique bindings, authenticated readback and trusted server-time behavior.
2. Authorize alias DNS/TLS/ingress changes while retaining old upstream/state. Run `testnet-endpoint-migration-check.mjs --live --transports --explorer --transaction <existing-hash> --contract <existing-address>` and the remaining public consumer/transport/shared-state gates. Two-block depth and stable growth are observations, not an irreversible-finality certificate.
3. Update necessary owner-held CSP/URL/manifest configuration only after corresponding alias acceptance, then rebuild and verify the actual public/installed release. No blanket global string replacement.
4. Official Broker Sandbox remains separately blocked on secure credentials/account permissions and explicit bounded virtual-order authorization. Mainnet/live/production approval remains false.

Recovery: keep `baab2a4e729028b203eadebdb27f054258107908` as the prior network checkpoint; inspect/recover it in a separate worktree. Revert later network-only commits only in the integration owner branch after review. Never reset another owner or delete chain/Faucet admission data. Active consumers already use old endpoints, so this source-only package requires no public rollback.
