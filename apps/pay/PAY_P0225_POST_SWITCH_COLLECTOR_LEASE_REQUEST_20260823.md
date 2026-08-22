# Pay P0-225 production/public lease request

This is a wholly new Pay-only request after P0-224 was released fail-closed and the old production baseline was restored. It does not reuse P0-224 authority.

## Frozen correction

- Owner checkpoint: `f1075dcbfcc5c677294db2dd58217d55a6f74b07` / tree `674e6330e0466c36595f435b89dd284c93a1bd11`.
- Collector: `apps/pay/scripts/pay-public-post-switch-collector-p0225.sh`, blob `ac570bd88cca54b31f49f9759c1e94a83ae0c015`, 8189 bytes, SHA-256 `cdcaec119fa675a77424425ff9b5b02aad01f9e5dac8749964880eb49e7adeb5`.
- zsh actual-shell fixture: `apps/pay/scripts/test-pay-public-post-switch-collector-zsh.sh`, blob `642d247a3c5de2791d742a2b0db5bb5d9636f573`, 1689 bytes, SHA-256 `db544ffbd0c21e1835c3f0193f81c2c73f5a43b864cad5bf3e68afa0dc3b06b6`.
- Fixture result: PASS.

The collector uses `resource_path` and `safe_name`, never zsh's special `path` variable. The fixture invokes the exact collector from `zsh -f`, proves the caller `PATH` is unchanged, proves `tr` and `shasum` remain resolvable, and captures the four required resource classes: root/index, build identity, release manifest, and nested assets. It verifies all eight distinct manifest resources, source/tree, JSON plus no-store identity headers, Pay Caddy/runtime/listeners/health, and writes browser preconditions only after those gates pass.

## Prior terminal boundary

P0-224 is released at Central `f384af6871a18d24abd0007825fa0923eec4efcf` / tree `aa922582fa9e849c41589d94f34066a0d8f51d90`, lease blob `7601f534f0e75ba6ed43d0a2c0f6cd168a603921`, SHA-256 `c602321ea345ffd47ed93b5ab749b29f2602b1f61786190bb2da0b91f3d03182`, status `CONSUMED_RELEASED_FAILED_CLOSED_LOCAL_POST_SWITCH_COLLECTOR_PATH_VARIABLE_COLLISION_ROLLED_BACK`. The rollback restored Caddy SHA `df5f7ad7...`, removed the exact release/stage inodes, retained the same Pay PID and listeners, and restored root/version/callback 404 plus health 200. Heavy and locks are released.

## Requested single-use transaction

Central must independently fresh-read the restored P0-222 baseline, confirm both fixed release/stage paths and the new local evidence path are absent, and bind the existing exact deploy/rollback objects plus the new collector object. After one successful deploy, the only collector command requested is:

```text
PAY_KNOWN_HOSTS=/Users/huangjiahao/.ssh/known_hosts '/Users/huangjiahao/Desktop/YNX Final Worktrees/04-pay-p0-clean/apps/pay/scripts/pay-public-post-switch-collector-p0225.sh' /tmp/ynx-pay-p0225-public-release-20260822T230000Z/http
```

Then a non-sensitive clean-browser cold and second launch must prove the stable official URL, default English, one tab, no blank/custom-scheme tab, zero console/page/network errors, and truthful `Waiting for Wallet` without a fabricated account or chain. Any deploy, collector, or browser failure requires at most one invocation of the frozen rollback object. No retry is requested.

This request excludes `eth_requestAccounts`, account approval, signatures, typed data, transactions, non-Pay services, and every other product path. Even success is only source-bound public Pay shell evidence, not full Wallet parity or product completion.
