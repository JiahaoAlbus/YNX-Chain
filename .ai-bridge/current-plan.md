# Current Plan — YNX Trust Center

## Current phase

`FREEZE`

## Protected checkpoints

- Route-level Wallet scope enforcement: `f042dd5b20833497333477bd99cf9d7542eceb38`
- Subject-scoped JSON export: `77ad082036a866c9730f8ca3694d977fa56cc171`
- Verified backup/restore runtime: `d31811280ba741026c74a836a212f78fe88c172a`
- Local and remote SHA match at `d31811280ba741026c74a836a212f78fe88c172a`.

## Closed autonomous gaps in this checkpoint

1. Exact central Wallet scopes are enforced on product and authority routes; wildcard, duplicate, unknown and insufficient scopes fail closed.
2. `GET /api/export` returns only records owned by or concerning the authenticated account and omits central sessions, replay internals and persistence seals.
3. `ynx-trust-backup` creates immutable mode-`0600` backups with manifest/state hashes and an envelope seal.
4. Restore rejects permissive, malformed, tampered or overwrite targets, then proves a clean cold start and subject-state equivalence.

## Immediate next engineering slice

Close the Trust-specific supply-chain gap:

1. generate a reproducible server/CLI release bundle;
2. create an SPDX or CycloneDX SBOM and third-party notices;
3. bind SHA-256, byte size, build inputs and source commit in provenance;
4. run secret, dependency, license and placeholder scans;
5. verify install/cold-start of the unsigned local artifact without claiming production signing.

## Following autonomous slices

- implement policy-bound retention/deletion workflow after the canonical policy is frozen;
- rerun Web 390px/RTL/keyboard/screen-reader evidence and native build gates;
- add metrics for integrity, export and restore outcomes;
- execute capacity/SLO and unit-economics measurements.

## External gates

- canonical Gateway registration and shared-Testnet execution by 29 Integration;
- retention/deletion policy approval by legal/privacy owners;
- healthy Android/iOS install targets and production signing assets;
- public hosting, DNS and independent verification.
