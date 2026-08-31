# Finance domain-source completeness — source-only checkpoint

Date: 2026-08-31

## Scope

This Finance-only change makes the existing `/v1/domain/portfolio` source object
carry safe, machine-readable provenance summary fields already present in the
underlying `SourceStatus` records:

- `coverage` is an explicit `explorer:<label>;pay:<label>` summary;
- `syncStatus` is a fixed aggregate (`aggregated-live`,
  `aggregated-partial`, `aggregated-stale`, or `aggregated-unavailable`);
- `error` is a fixed opaque code (`none`, `pay-unavailable`,
  `explorer-unavailable`, or `explorer-and-pay-unavailable`).

Coverage labels are restricted to a bounded identifier alphabet.  Missing,
oversized, or non-identifier values become `not-reported`.  No upstream error
body, endpoint, credential, or unbounded diagnostic is serialized into the
domain response.

## Exact source

- Commit: `ac09883347821643698b00e95db922195751edc2`
- Tree: `01aaed0618d41e8becb660f238233fa5651588b5`
- `internal/finance/domain.go`: blob `a99e8e11b47d0e2d8e1a4b081306223cae6ee264`,
  3,676 bytes, SHA-256 `dab50f8e9a8da9aa29a0acb77d17f076f929b3e05c2108fb4e4501e7bfb3ba18`
- `internal/finance/types.go`: blob `e3493e1709e159928fc18c82f2d29d5d7fbfbf11`,
  7,402 bytes, SHA-256 `f57622e362399fda781fab592bc9998ddacb203968e6e579057475387f957469`
- `internal/finance/finance_test.go`: blob `b9fff74293d0707f5221f89701b83b7d4ecaa682`,
  26,269 bytes, SHA-256 `1c626728fa3991544f0ba324e769f5ef2f721f7f8681c1445cd339b73195fc3d`

## Verification

Executed from the Finance-suite worktree:

```text
go test ./internal/finance ./apps/finance/...
go test -race ./internal/finance
git diff --check
```

All commands passed.  The regression suite verifies endpoint schema stability,
the partial-source summary, raw-error non-leakage, and rejection of untrusted
coverage labels.

## Release truth

This is a source/test checkpoint only.  It does not deploy Finance, modify the
public runtime, perform wallet approval, or establish Product Session,
installed-app, browser, or Testnet transaction evidence.  Those states remain
false until Central grants a new Finance-specific runtime/deployment lease and
the resulting source-bound runtime is independently verified.
