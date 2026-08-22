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

Monaco 0.55.1 is bundled under `/monaco`; no runtime CDN is required. Its worker
and font assets are covered by the desktop and Web CSP. The desktop compile
registry resolves only named executables already installed for the current user,
passes argument arrays with `shell:false`, denies network on macOS, bounds output
and runtime, and writes only inside the per-user project workspace. The public
Web surface does not run these local adapters. Declarative language packs can add
editing support but cannot add an executable command; expanding that boundary
requires a reviewed adapter and tests for both a successful and a failing exit.
The built-in catalog is intentionally broader than the bundled executables. Like
VS Code, the product discovers user-installed compilers and supports additional
languages through separate declarative editing packs and shell-free compiler
adapter manifests; catalog presence alone is not a readiness claim.

Do not add a direct deployment key or connect the UI to an unsigned local deploy
endpoint. Do not upgrade local source evidence to remote verification. Keep
compiler version `0.8.24`, optimizer enabled and 200 runs unless the canonical
toolchain and product contract change together.
