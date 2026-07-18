# YNX Developer developer guide

The Web surface is static HTML/CSS/modules plus framework-independent client
state machines. Run `npm test`, `npm run check` and `npm run build` in
`apps/developer`; run `npm test` in `packages/developer-client`.

Local servers expose only same-origin `/chain`, `/ai-gateway` and `/app-gateway`
prefixes. AI generation is a bounded POST-body SSE request. Browser headers are
not forwarded wholesale. New commands, RPC methods, sidecar methods, provider
permissions or Wallet scopes require tests and a fail-closed default.

Do not add a direct deployment key or connect the UI to an unsigned local deploy
endpoint. Do not upgrade local source evidence to remote verification. Keep
compiler version `0.8.24`, optimizer enabled and 200 runs unless the canonical
toolchain and product contract change together.
