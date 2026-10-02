# Finite identity family backend

This package implements only `identity:read` for the registered Finance tuple.
It does not create, extend or approve private ProductSession permissions.

`NewClient(Config)` requires an operator-provisioned Ed25519 PKCS8 PEM private
key and a separate raw 32-byte local sealing key. Both files must be absolute,
same-UID regular files with mode 0600. `StorePath` is a bbolt database in a
same-UID private 0700 directory. The Central confidential-client configuration
must register the matching public key and key ID before Finance opts in.

Prepare before redirect and retain its opaque IntentID in the existing sealed
pending container. On logout, pass both the cookie's FamilyID and pending
IntentID when present. No client-global logout fence is used. FamilyID is a
local opaque reference; access tokens, handles and codes remain sealed on the
backend. Cookie expiry is the original absolute deadline; every Resolve still
checks the current idle deadline and calls Central introspection.

Only an authenticated, same-origin, CSRF-checked, allowlisted user action may
call Activity. Focus, visibility, polls and WebSocket traffic are not activity.
Network failure fails closed without deleting identity. Logout first commits a
local fence; uncertain revocation retains its exact request for explicit retry.

The new confidential response includes the exact approved profile and its
canonical client-list digest. Renewal must preserve them, identity generation,
audience, scope and the original absolute lease. The legacy token response is
unchanged.

Before the first family activation, stage a rollback Node artifact containing
the reviewed schema-2 store reader, approved-client guards and family handlers.
Keep the same protected backend-client configuration, seal, state and journal
on rollback. Original schema-1-only Node code is not a valid rollback after
migration. Disabling family configuration does not downgrade or rewrite state;
it deliberately prevents further renewal while existing valid grants remain
subject to introspection and revocation checks.

Tests include actual loopback Central Node routes and durable state with
synthetic accounts, authenticated Go proofs, lost-response restart recovery,
schema-2 guarded reads, cross-browser isolation and SIGKILL transaction cases.
They are engineering tests, not public user acceptance.
