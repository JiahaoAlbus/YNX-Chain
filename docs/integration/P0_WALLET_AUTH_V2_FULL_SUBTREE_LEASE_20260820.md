# P0 Wallet/Auth v2 full-subtree replacement lease

The seven-file v2 lease failed closed before deployment because public source `49e30d999` lacks its imported Product Session dependency closure. It is superseded and cannot be reused. Production stayed active on `wallet-auth-49e30d99`; no backup or mutation started.

Integration independently reproduced the exact replacement closure: full `packages/wallet-auth` tree `4c544d2e2ddb63caef536ea67c8f27b45044fd89` at source `6cf3ef845202bd879ed94515a71b323dd2fc9e14`, 160 Git entries. The frozen inventory is 18,241 bytes with SHA-256 `a96ba130a236459e6a3352d6c14be91c7c6bd0945b2eb019b5e65811ef3137b0`; the deterministic prefixed tar.gz is 462,902 bytes with SHA-256 `fac046697f8cc3902976764f959d69f83e13067c37abfe2b37f9b8adf7ba2da0`.

New lease `P0-WALLET-CONNECTIVITY-2026-08-wallet-auth-v2-full-subtree-lease-20260820T121054Z` permits only replacement of the exact Wallet/Auth subtree. Production activation is blocked until the complete subtree cold-starts against a copy of the actual `49e` runtime and v1 state, with the immutable v2 registry and independent v2 state path. Any dependency, state, ownership or startup mismatch stops the transaction and requires another Integration amendment.

Current public source, v1 state, Caddy, installed clients, product migrations and aggregate truth are unchanged. Public v2 lifecycle, deployment, integratedCentral, signing and store gates remain false.
