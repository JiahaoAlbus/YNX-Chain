# Finance public-entry routing inheritance — 2026-10-04

Base: `113b35b99b2e21f26b3f5b012886fb343c8c0f26`.

Owner implementation is limited to `apps/finance/cmd/server/**`; the inherited
`internal/finance/server.go`, Wallet SDK, authentication and business logic are
unchanged. The outer handler provides explicit `/app` and `/index.html` routes
through the existing application handler, preserving query, method and callback
semantics. Only a GET/HEAD query-free root may serve a regular introduction file.
An absent or symlink introduction leaves the original application available.
The introduction asset map is explicit, not a directory-wide file server.

This is routing preparation, not a completed introduction or release. New
introduction assets have not been added or packaged in this checkpoint. No
public deployment, browser approval, installation, account, signature or
transaction is claimed. Introduction implementation must still preserve legacy
hash routes in its entry script and add its exact assets to the runtime package.

Executed checks:

- Red test before implementation: undefined `introductionHandler` (build fails).
- `go test ./apps/finance/cmd/server -count=1`: PASS, 0.543s.
- `go test ./internal/finance/... ./apps/finance/cmd/server -count=1`: PASS;
  Finance 18.586s, brokerage 0.389s, server 0.630s.
- Routing regression covers root, explicit app, index, query-bearing auth return,
  both callback routes, API, health/version, download delegation, unknown paths,
  request immutability, POST forwarding, HEAD and missing/symlink fallback.

No Host, SSH, shared directory, production configuration or other owner mutation.
Rollback of this source checkpoint is a normal revert; no database migration.
