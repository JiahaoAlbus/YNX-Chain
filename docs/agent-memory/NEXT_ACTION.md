# YNX Seller Console Next Action

Implement the bounded provider registry in the Seller-owned Commerce state.

## Exact execution sequence

1. Add provider records for `shipping`, `tax`, `address`, `storage`, `email`, `webhook`, `pay` and `trust`.
2. Permit only `disabled`, `sandbox`, `testnet` and `production` modes; default to `disabled` and fail closed on unknown values.
3. Persist endpoint metadata, capability declarations, health state, last test time, last rotation time and an external access-material reference only. Reject inline access material.
4. Restrict list, configure, test, disable and rotation-metadata operations to the exact Seller store Owner.
5. Bound test attempts by timeout and rate limit; represent timeout, rejection and outage truthfully without converting them to healthy.
6. Audit every configuration, test, disable and rotation-metadata event.
7. Preserve provider records across restart and roll back state/Audit together on persistence failure.
8. Expose provider state through Seller API and `/api/capabilities` without claiming central Pay/Trust or carrier/tax acceptance.
9. Add tests for authorization, mode validation, inline-material rejection, outage, timeout, rate limit, disable, restart and persistence failure.
10. Run `go test ./internal/commerce/...`, `go test -race ./internal/commerce`, `go vet ./internal/commerce/...`, Seller `npm test` and `npm run build`.
11. Review, commit, push, verify Local SHA = Remote SHA, and bind contract/vectors/release/Agent Memory to the exact source commit.

Do not modify other product worktrees. Do not introduce provider fixtures that can be mistaken for production verification.
