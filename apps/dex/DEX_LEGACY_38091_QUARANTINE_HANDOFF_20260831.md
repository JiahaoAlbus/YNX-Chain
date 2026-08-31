# DEX legacy 38091 route quarantine — 2026-08-31

## Read-only finding

Two non-authoritative nested worktrees contain identical legacy Shop/Music
deployment material. Neither is the current DEX worktree or an input to the
DEX PWA build.

| Nested repo | HEAD | Dirty state | Legacy path | Blob |
| --- | --- | --- | --- | --- |
| `.codex-worktrees/24-finance` | `edb389e71e13dc77dd00d4c3bb82250ba91f0e85` | untracked `release/local-delivery/` | `deploy/shop/install-staging-routes.py` | `8878e4913277236f7c477523b7d507860fc5fc54` |
| `.codex-worktrees/27-dex` | `728038aa90d067a20e83783d4a057011c2070c1f` | untracked `release/local-delivery/` | `deploy/shop/install-staging-routes.py` | `8878e4913277236f7c477523b7d507860fc5fc54` |

Both also contain `apps/music/deploy/web4-music.caddy` blob
`0e522e405428b6ace404297190059ba84a59d465`. Their own historical packaging
and deployment entries reference the Shop installer and the legacy
`127.0.0.1:38091` fallback; this is Shop/Music scope, not DEX scope.

## Quarantine decision

No `6423` port replacement is authored here: `6423` is the YNX EVM chain ID,
not an approved HTTP listener or a safe substitute for an unrelated Shop/Music
fallback route. Repointing those files from DEX would create a cross-product
deployment change and could misroute traffic.

The authoritative DEX source has no reference to the three quarantined legacy
identifiers. `npm run verify:legacy-route-quarantine` enforces that executable
DEX source cannot inherit them. It scans only `apps/dex/src`, `public`,
`scripts`, `index.html`, and `package.json`; it intentionally does not mutate,
scan, or make claims about the nested historical repositories.

## Required owner action

Shop/Music/Website release owners must decide whether their historical route
files are retired or still in a signed deployment path, then issue a
product-owned replacement or removal plan. DEX has made no Caddy, SSH,
deployment, wallet, signing, swap, liquidity, or transaction change.
