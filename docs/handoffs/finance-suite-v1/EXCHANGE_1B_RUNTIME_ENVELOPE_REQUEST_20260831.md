# Exchange 1b runtime envelope request — 2026-08-31

## Exact local candidate

The current Exchange source checkpoint is `1b263be6ed29341046f78657f6587afa13f3b629` (tree `c9fed17d8eab3955f18e9af1a74b250d9e3a71b0`). It includes the Standard Wallet wrong-chain guard that rejects `eth_requestAccounts` until the selected provider verifies `0x1917`; the former a9 candidate does not represent this checkpoint.

The existing deterministic packer was invoked locally with `GOOS=linux GOARCH=amd64 CGO_ENABLED=0` and no product-worktree write:

| Item | Value |
| --- | --- |
| Runtime archive | `/tmp/ynx-exchange-1b263be6ed29-runtime-source-candidate.tar.gz` |
| Archive bytes / SHA-256 | 3,693,273 / `d462780a12f32e078d07bde581ecc0aef1c4319e56decda8cc6cbd3ed78c2a32` |
| Linux amd64 server | 8,286,392 bytes / `fc305e22aa1216964f758bc4fd0ffed44818b32346c148a68c40981e48dea3f1` |
| `web/wallet-connect.js` | 19,750 bytes / `d99a05561eb9d639937ffe8f62935cd499695728444a2505440b4fca130f6591` |
| Bundle manifest | 1,460 bytes / `1c85e42018a3f7fe548c2b71c9852298051028bc764ee5ddc907462de923aba1` |
| SHA256SUMS | 550 bytes / `b57ebb11352e4da877bada8c1dccf064531e55e1f1d35a096b8020437eef314c` |

Focused source gates are recorded in `FINANCIAL_SOURCE_GATE_READBACK_20260831.md`: 14/14 unit, 3/3 local browser, and the provider-only verifier pass. This archive is local and unsigned; it is not a public, installed, Wallet-approved, order, fill, custody, or Testnet transaction claim.

## Required Central mapping before any deployment lease

The current public Exchange root, `/health`, and `/version` return an HTML fallback in the accepted a9 runtime audit. Central must therefore bind a fresh, read-only runtime envelope for this source candidate before issuing a deployment lease:

1. exact host, service unit, working directory/current symlink, Caddy route, process user, port, environment file identity, and database backend posture;
2. exact old release/binary/web asset/environment/unit/Caddy hashes and rollback commands;
3. non-fallback loopback and public `/health` and `/version` URLs, with status, bytes, body hash and MIME contracts;
4. stage, backup, release and control paths, each with absence/identity/ownership fences;
5. PostgreSQL multi-instance readiness evidence or an explicit fail-closed refusal to enable multi-user order paths;
6. a separate single-use Exchange-only rollback-first deployment lease.

No Finance, DEX, Quant, Wallet, Website/global registry, account approval, signing, order, matching, settlement, withdrawal, or production action is included in this request.
