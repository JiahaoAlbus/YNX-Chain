# Finance non-regressive namespaced Phase3 handoff

This is a Finance-only deployment request. It does not authorize SSH, deployment, service lifecycle, account access, signing, or transactions.

The exact P0-314 carrier remains at `/opt/ynx/stage/finance/finance-combined-4f7fba323a89-20260831t041500z`. The production executor now requires a distinct signed stage namespace ending in `-deploy`, while backup and release remain bound to the carrier namespace. This removes the prior impossible requirement that an already-present carrier directory also be absent as the Phase3 stage container.

The reviewed OpenSSH transport accepts a path to the exact base64 executor carrier, verifies its bytes and SHA-256 before SSH, and only then expands it into the remote bootstrap argument. The full local command therefore contains no shell substitution, variable concatenation, credential value, or dynamically generated executor payload.

Central must fresh-read all production tuples and raw old health/version receipts, construct and sign a wholly-new Finance-only Phase3 lease, replace only the four fields declared in the request's literal argv contract, and issue a time-bounded single-use lease. P0-304, P0-314, and the earlier 7267 request are nonreusable.

On candidate failure, the executor automatically restores the old symlink, environment, state and service before reporting failure. Any manual rollback after a successful terminal receipt requires a separate newly signed rollback lease; it is not authorized here.
