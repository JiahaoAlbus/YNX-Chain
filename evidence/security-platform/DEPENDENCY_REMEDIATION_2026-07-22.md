# Dependency Remediation — 2026-07-22

## Detection

GitHub Security run `29930788053` failed the production dependency vulnerability gate. A local reproduction identified:

- `GHSA-58qx-3vcg-4xpx`: uninitialized memory disclosure in `ws`;
- `GHSA-96hv-2xvq-fx4p`: memory exhaustion denial of service in `ws`;
- vulnerable path: `ethers 6.16.0` to `ws 8.20.1`;
- audit severity: one high and one moderate.

## Remediation

- Root SDK and both infrastructure services now require `ethers ^6.17.0`.
- AI gateway and bridge service override `ws` to `8.21.1`.
- Fresh lockfile installation resolved root `ethers 6.17.0`, root `ws 8.21.0`, and service-local `ws 8.21.1`.
- Full contract, SDK, bridge, AI gateway, Web4, artifact, backup, policy, Go test, and Go vet suites passed after installation.

The remote audit rerun is required before this remediation is considered closed. Local advisory requests were intermittently unavailable and are not represented as passing evidence.
