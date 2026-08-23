# Finance Phase 2 candidate-env preparation request

This is a wholly new Finance-only preparation request. It is not a deployment
lease and must not be executed while another Heavy lease is active.

## Accepted prerequisite

- Central acceptance: `f971effaea38b9346fa28c3977e1cb0a9a6bd6b7` / tree `98878d0c321d93c72abb288ff8487dc5d29faa7a`.
- Acceptance record: `release/integration/p0-wallet-connectivity/acceptance/p0-230-finance-phase1-settled-tuples-readonly-acceptance-20260823.json`, blob `ed3f17e1f346449225f2c9360aa77058df8b9d2f`, 5,240 bytes, SHA-256 `6dcdcb66a856be54ae2d1a2883a47f6c75ba262f1eab2c9de49cd50fc6977db0`.
- Accepted owner checkpoint: `53461ff4bf329dc9473a4ba0d48ec903342c9c16` / tree `a459379f6c2718db767a0eb84aeb65a8bdd74ec6`.
- P0-228 remains fail-closed and nonreusable.

The exact settled Phase 1 tuples, empty carrier, PID `877083` and `NRestarts=0`
are imported without alteration from the accepted P0-230 record. The only
permitted carrier is `/opt/ynx/stage/finance/p0228-finance-phase1-20260822T234100Z`.

## Frozen command objects

- Generator: `finance-candidate-env-generator.sh`, 1,698 bytes, SHA-256 `cf7b804be50e8f75765f52b67e39e62a67e211add8bb17edcadf2b4e25940c07`.
- Phase 2 executor: `finance-candidate-env-preparation.sh`, 4,251 bytes, SHA-256 `619a32c3476ac710a8a8c9a74c7c35c5f64f29e68b1c3561d2e73736c3d24075`.
- Actual-shell fixture: `test-finance-production-fixture.mjs`, 22,881 bytes, SHA-256 `a422e29b0b20161f4e7c1f117f9601f9623ad2c816cf3353ad59b895b5f1d2f8`.

## Future lease-bound command arrays

Central must sign one safe `LEASE_ID` with no slash, dot or traversal segment,
the approved archive source and all pre/post file tuples/hashes. The executor
accepts only these literal destination paths:

```text
[
  "install -m 0600 -- <signed-lease> /opt/ynx/leases/finance-preparation/${LEASE_ID}.json",
  "install -m 0600 -- <approved-archive> /opt/ynx/leases/finance-preparation/${LEASE_ID}.archive.tgz",
  "install -m 0700 -- <frozen-generator> /opt/ynx/leases/finance-preparation/${LEASE_ID}.generator.sh",
  "install -m 0700 -- <frozen-executor> /opt/ynx/leases/finance-preparation/${LEASE_ID}.phase2b.sh",
  "/opt/ynx/leases/finance-preparation/${LEASE_ID}.phase2b.sh /opt/ynx/leases/finance-preparation/${LEASE_ID}.json"
]
```

Before transfer, the lease must bind containment, parent/carrier settled tuples,
absence of every Phase 2 destination, file type, device/inode/uid/gid/mode/nlink,
bytes and SHA-256. The executor rechecks all of them, validates required env keys
by key name and exactly-one presence only, and never prints environment values.
It emits only path, tuple, byte and SHA-256 receipts for the staged archive and
candidate env. Failure cleanup may remove only executor-created files whose exact
regular-file tuple and SHA-256 still match; it never removes a Phase 1 directory.

Forbidden: deployment, restart, current-link switch, unit/Caddy/public change,
state mutation, account request, signature, transaction, secret output or any
secret readback. A new Central lease is required before every command above.
