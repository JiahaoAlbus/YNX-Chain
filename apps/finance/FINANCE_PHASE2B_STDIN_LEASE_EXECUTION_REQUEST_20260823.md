# Finance Phase 2B signed-lease stdin request

Phase 2A is terminally successful at Central `3d5f95ca7d907333781c32919a06405696864195`. The three immutable payloads exist with exact post-read tuples and hashes, the Phase 1 carrier remains empty, and Finance remains PID `877083` with `NRestarts=0`.

This successor asks for one new Phase 2B lease only. The local bootstrap receives the Central-signed, non-secret lease JSON on stdin, verifies the six directories and three Phase 2A objects, creates only the exact lease JSON, and executes the already placed `phase2b.sh`. The Phase 2B program reads `/etc/ynx/finance.env` but never prints values; it copies the candidate archive into the carrier and creates a derived candidate env whose only changed field is `YNX_FINANCE_WEB_DIR=/opt/ynx/releases/finance/ynx-finance-7824af677dd0/web`.

Before signing, Central must freshly bind the six directory tuples, three payload tuples/hashes, empty carrier, absent `.json` and `.json.pending`, secret-safe production env tuple/bytes/SHA plus the unique presence of required key `YNX_FINANCE_WEB_DIR`, and unchanged service PID/restart state. Execution is exactly one strict-host SSH under `sudo -n`; bootstrap bytes are passed as a SHA-bound base64 argv and stdin contains only the signed lease JSON.

Success authorizes no extraction or deployment. It returns only paths, tuples, byte counts and SHA-256 values for the signed lease, carrier archive and derived candidate env. Release extraction, service restart, current symlink, unit, Caddy, public mutation, accounts, signatures and transactions remain forbidden.
