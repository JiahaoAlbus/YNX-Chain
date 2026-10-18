# Anchor-order source qualification candidate

This independent candidate binds the measured records-first source to a complete
immutable internal tree and exact current mapped inputs. It inherits the existing
candidate.6 semantic contract by validating that original candidate against its
original immutable source; no old candidate or guard is changed.

The runtime delta is exactly two boolean operand reorderings. Existing application
records determine the AppHash path before an otherwise redundant account JSON
comparison. Full semantic validation, hashing, fee audits, nonce/replay and durable
Commit checks remain. The cost benchmark compares full Validate on the same
retained actual 1024-transfer state and matching migration. This is not network TPS.

The supplied evidence records a whole CI failure at the old identity gate while
complete Go source checks and the new measurement passed. Normal matching CI is
pending at this immutable candidate's creation. Deployment, node cutover,
sustained1000TPS and network finality are not claimed. Future normal CI results
belong in an additive evidence receipt, not a rewrite of this candidate.

The frozen Supply-client network candidate remains independent and unchanged.
