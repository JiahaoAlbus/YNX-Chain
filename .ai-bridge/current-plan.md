# Current Plan — YNX Trust Center

## Current phase

`FREEZE`

## Protected checkpoint

- Runtime commit: `4e78f47e9b2dedee71c12adf9790374412b45356`
- Local and remote SHA matched at the checkpoint.
- Trust state format v2 is tamper-evident and legacy v1 migration is tested.

## Immediate next engineering slice

Enforce exact central Wallet session scopes at runtime for:

1. product-local state and action routes;
2. authoritative evidence/governance/appeal/transparency proxies;
3. AI explanation routes;
4. future subject export.

Required negative tests:

- missing required scope;
- wildcard scope;
- wrong product/device;
- scope widening;
- valid least-privilege scope;
- revoke and expiry behavior unchanged.

## Following slice

Implement subject-scoped JSON export and a hashed backup/restore drill, then update coverage and release evidence.

## External gates

- canonical Gateway registration by 29 Integration;
- healthy Android/iOS execution environments and signing assets;
- public hosting/DNS and independent verification.
