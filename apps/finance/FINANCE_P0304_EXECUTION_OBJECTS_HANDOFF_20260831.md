# Finance P0-304 execution-object handoff

Source/evidence only. This package is not a Central lease and does not authorize
SSH, deployment, rollback, cleanup, service/configuration mutation, account
approval, signature, or transaction.

## Exact baseline

- Owner base: `1d50967685e249789d6fec752279c39277a60931` /
  tree `9c6a1a559ed53a7b755603ac2ccb7e790abc03e2`.
- Required executor: `448851ba7d33399385b89eb3356bc9ce4f345721` /
  tree `d407c85c98e616e001c2cf4260dbfee918c47557`.
- P0-303 terminal: `8a15916604e8115c1bc13ebb21a5391a771bd505` /
  tree `c0989b450183c51b530ad8e73bb2698e3b1266bf`; it proves zero
  mutation and that the old runtime remains healthy.

## Frozen objects

- `apps/finance/evidence/finance-p0304-execution-objects-request-20260831.json`
  binds all objects and the unique namespace.
- `apps/finance/evidence/finance-p0304-unsigned-lease-stdin-candidate-20260831.json`
  is a complete unsigned candidate. It has `lease.signed=false`, a null
  Central signature, and `executable=false`.
- `apps/finance/evidence/finance-p0304-literal-argv-candidate-20260831.json`
  freezes the 25 literal process arguments and its own argv JSON SHA-256.
- `apps/finance/evidence/finance-p0304-parent-preserving-observer-contract-20260831.json`
  binds the non-reconstructing, output-preserving observer.
- `apps/finance/scripts/test-finance-p0304-execution-objects.mjs` reconstructs
  every declared local object identity and rejects shell, variable, and
  concatenated argv substitutes.

## Execution boundary

- Namespace: `p0304-finance-phase3-20260831t030400z`; the six mutable remote
  paths are stage container/leaf, backup container/leaf, and release
  container/leaf.
- Stdout carries the executor phase/failure protocol. The only atomic pending
  local output is the transport receipt pending path; both locations are frozen
  in the request.
- The parent-preserving observer can observe only child status, signal, and
  error. It cannot open, create, redirect, truncate, append, or inspect the
  declared output paths.
- A future execution is limited to one SSH and one deployment invocation with
  no retry, only after a separately signed, nonexpired Finance-only lease.

## Central action remaining

1. Freshly read and bind parent/runtime/carrier/path-absence identities.
2. Sign the candidate (or issue a superseding candidate with matching new
   stdin/argv identities and expiry).
3. Issue the single-use Finance-only lease.

All deployment, public-runtime, Wallet approval, signing, transaction, and
Central-signature flags remain false.
