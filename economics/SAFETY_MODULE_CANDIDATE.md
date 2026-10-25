# YNX Safety Module Candidate

The Safety Module candidate is a deterministic loss-allocation simulator, not an activated protocol, contract, insurance product, custody service, or promise that a shortfall will be covered.

## Candidate invariants

- Participation is voluntary and accepts only `native_wallet_ynxt` provenance.
- Derivative claims and recursive restaking are rejected.
- Active stake plus still-cooling stake cannot exceed the configured module cap.
- Cooling stake remains slashable until the full cooldown completes; completed exits are excluded.
- A slash requires an explicit `protocol_shortfall` or `consensus_safety_failure` reason and a 32-byte evidence hash.
- The waterfall uses the stated insurance reserve first, then at most the per-participant policy slash cap, allocated proportionally and deterministically.
- Uncovered loss remains an explicit residual. The model never labels it covered.
- Execution, activation eligibility, and guaranteed yield remain false regardless of scenario inputs.

## Missing activation evidence

Activation requires a separately reviewed consensus or contract implementation, governance authority and timelock, formal safety properties, economic/adversarial simulation, independent security audit, public risk and incident disclosures, appeal and recovery procedures, operator controls, deployment evidence, and public monitoring. None of those is inferred from `make safety-module-candidate-check`.

Service-specific Oracle, Bridge, Storage, and AI Compute security pools require isolated slash domains, independent caps, and proofs that they cannot recursively restake or trigger cross-service liquidation. They remain outside this candidate.
