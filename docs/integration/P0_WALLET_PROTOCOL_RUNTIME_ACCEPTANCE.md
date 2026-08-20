# P0 Wallet Protocol runtime acceptance and execution lease

Central Integration accepts the Wallet/Auth Origin Binding candidate for one controlled runtime transaction. This is not `integratedCentral`, public deployment, public CORS, installed-client, signing or store acceptance.

The immutable behavior contract is `66003e76e804da16d472255efde50cb879055b96` (PR #104). The deployable owner scope is only `packages/wallet-auth`: CORS source `b28609abab6df3ed88bb58cf04472308068eaa0c`, Origin Binding source `5231e7509d6218bbbf25029cf73d456992cc37bd`, handoff `b9194a3c3ffa012d5dbb8b9dd8dcf421abd1f9fd`, and evidence head `460353c654cd6fb907c734a884d54c21806cef23`. The exact evidence head passed 119/119 and package dry-run after isolated materialization with read-only workspace dependencies.

The candidate branch diverges historically from the current control plane. It must not be merged as a whole tree. The deployment owner must materialize the exact `packages/wallet-auth` subtree at `5231e750…`, preserve the accepted `66003e76…` contract and b919/460 handoff evidence, and leave every other repository and product path unchanged.

The execution lease is `release/integration/p0-wallet-protocol-execution-lease.json`. It is owned by `wallet-protocol`, executed only by `wallet-auth-gateway-runtime-owner` through `codex/p0-wallet-protocol-integration-20260820`, expires at `2026-08-20T11:05:24Z`, and authorizes one rollback-protected Wallet/Auth Gateway runtime transaction. It excludes Wallet UI/platform packages, other products, Chain Core, website changes and unrelated service restarts.

Current direct public truth remains negative: `https://wallet-auth.ynxweb4.com` reports source `6ed04310383ed924065d23affc71f3e4d4c29d49`; the registered Social Origin OPTIONS request to `/v1/wallet/sessions/complete` returns 405. Runtime deployment/CORS/lifecycle and installed-client acceptance are false. Installed-client ComputerControl requires a separate lease only after every runtime acceptance item passes.
