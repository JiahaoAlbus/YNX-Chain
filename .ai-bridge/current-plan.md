# Current Plan — YNX Trust Center

## Current phase

`FREEZE`

## Protected checkpoints

- Exact route-level Wallet scope enforcement: `f042dd5b20833497333477bd99cf9d7542eceb38`
- Subject-scoped JSON export: `77ad082036a866c9730f8ca3694d977fa56cc171`
- Verified backup/restore runtime: `d31811280ba741026c74a836a212f78fe88c172a`
- Source-bound CI and hosted Testnet preview: `1baeccada8e72eab8277803973d0e598dcf19b51`
- Successful GitHub Actions run: `30416831778`
- GitHub prerelease: `trust-center-v0.1.0-testnet-preview.1`

## Closed autonomous gaps

1. Exact central Wallet scopes are enforced on product and authority routes; wildcard, duplicate, unknown and insufficient scopes fail closed.
2. `GET /api/export` returns only records owned by or concerning the authenticated account and omits central sessions, replay internals and persistence seals.
3. `ynx-trust-backup` creates immutable mode-`0600` backups with manifest/state hashes and an envelope seal.
4. Restore rejects permissive, malformed, tampered or overwrite targets, then proves a clean cold start and subject-state equivalence.
5. The Trust workflow now passes source-bound GitHub CI, reproducible build, module integrity, vulnerability, license, focused secret/placeholder and install/cold-start gates.
6. The Linux amd64 preview, SBOM, provenance, verification, checksums and notices are hosted in a truthful unsigned GitHub prerelease.

## Immediate next engineering slice

Refresh current user-interface and native evidence:

1. execute the Web Playwright suite at 390px and desktop widths;
2. verify Arabic RTL, keyboard focus, reduced motion and accessible labels;
3. refresh Android build/install evidence when a healthy target exists;
4. refresh iOS build/Simulator evidence when the toolchain target is available;
5. update UI audit and release metadata without promoting public deployment or production signing.

## Following autonomous slices

- add metrics for integrity, export and restore outcomes;
- execute capacity/SLO and unit-economics measurements;
- prepare the exact 29 Integration acceptance packet and shared-Testnet vector invocation;
- implement policy-bound retention/deletion only after canonical policy approval.

## External gates

- canonical Gateway registration and shared-Testnet execution by 29 Integration;
- retention/deletion policy approval by legal/privacy owners;
- production release acceptance, encrypted remote custody and independent restore approval by 30 Security/SRE;
- healthy native install targets and production signing assets;
- public deployment of `https://ynxweb4.com/trust-center` by 28 Website.
