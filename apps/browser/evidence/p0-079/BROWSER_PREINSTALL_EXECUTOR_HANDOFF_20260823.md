# Browser preinstall executor handoff

The previous request was rejected because the forward and rollback command objects were not frozen. This successor closes that source/evidence gap without installing or registering anything.

## Exact source

- Branch: `codex/p0-browser-current-source-verification-20260821`
- Source commit: `6ace4556ceaa7f4d72f896a4ad4a5505014f030c`
- Tree: `498aa15c87bc64e25d26f35c8eee4639b381d635`
- Executor: `apps/browser/scripts/browser-preinstall-executor.sh`
- Executor SHA-256: `93160c379c58671ca7fdc7dab42daa9a2ef4bee0987093f695ade0456f0cb3b7`

The request JSON freezes exact forward and rollback argv/environment objects. Production mode fails closed unless `YNX_BROWSER_LEASE_AUTHORIZED=P0_BROWSER_SINGLE_USE` is present.

## Safety behavior

Forward creates only the absent isolated candidate target, verifies its app inode and executable SHA, proves no candidate process, registers only that candidate, and resolves the handler without invoking the scheme. It contains no launch or process-termination command.

Rollback starts by requiring the receipt, candidate app inode, executable SHA and no candidate process. It then unregisters only the candidate, re-registers the exact old handler, resolves it without launch, and deletes only the still-exact non-running candidate. It never unregisters, moves, launches, terminates or deletes any old copy or old PID.

## Direct fixture evidence

The actual shell fixture passed `3/3`. It creates eleven old application sentinels plus an old PID sentinel, executes forward and rollback, and records the only LaunchServices operations as:

1. register candidate;
2. unregister candidate;
3. register exact old handler.

All eleven old copy bytes and the old PID sentinel remain exact. A reported candidate process causes rollback to stop before unregistering or deleting anything. Production mode without a lease is rejected.

The full Browser Node suite passed `21/21`; smoke and source gates passed. The existing local CommandLineTools duplicate-xcspec failure still prevents a new Swift reproducibility build and is not promoted.

## Requested next action

Central should review `browser-preinstall-executor-lease-request-20260823.json` and issue one nonreusable Browser-only lease only after freshly re-reading the exact old handler, all eleven colliding copies and every old PID. No installation, LaunchServices mutation, launch, account request, signature or transaction occurred in this slice.
