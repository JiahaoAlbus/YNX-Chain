# YNX Developer developer guide

The Web surface is static HTML/CSS/modules plus framework-independent client
state machines. Run `npm test`, `npm run check` and `npm run build` in
`apps/developer`; run `npm test` in `packages/developer-client`.

Local servers expose only same-origin `/chain`, `/compiler`, `/ai-build`,
`/ai-gateway` and `/app-gateway` prefixes. Desktop packages default these
prefixes to the public Developer service, so chain status, the pinned compiler,
and AI Build keep working after a second cold launch without requiring local
YNX daemons. AI generation is a bounded POST-body SSE request. Browser headers
are not forwarded wholesale; only the three explicit AI broker headers can
cross the desktop proxy.

The public service runs real `solc` 0.8.24 work in worker threads with four
active workers and a queue of 64. The hosted open model uses a separate queue of
two active requests and 32 waiting requests. Desktop test/check/package work has
its own two-active/16-waiting queue and a per-user hashed workspace. Package
installation uses the bundled npm CLI with `--ignore-scripts`, exact package
spec validation and no global install. New commands, RPC methods, sidecar
methods, provider permissions or Wallet scopes require tests and a fail-closed
default.

Do not add a direct deployment key or connect the UI to an unsigned local deploy
endpoint. Do not upgrade local source evidence to remote verification. Keep
compiler version `0.8.24`, optimizer enabled and 200 runs unless the canonical
toolchain and product contract change together.
