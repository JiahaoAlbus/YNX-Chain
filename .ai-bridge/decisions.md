# YNX Quant Lab Decisions

## D-001 — Preserve recovered work before expansion

The recovered branch was ahead of remote and clean. Existing commits were tested,
then pushed before new runtime work. No reset, clean, force push or Dirty Change
discard was used.

## D-002 — Release validation must fail closed

The release gate no longer depends on unavailable `rg`, chooses only a healthy
Python 3.9+ interpreter, and validates archive safety and reproducible artifact
hashes. A skipped scanner or dead interpreter is a failure, not a pass.

## D-003 — Remote venue responses are untrusted

Exchange and DEX transports are owner-supplied narrow capabilities. Quant
completes only fresh terminal receipts fully bound to the reserved intent.
Nonterminal or invalid responses leave a durable unknown outcome and block
repeat submission until reconciliation.

## D-004 — Quant never gains custody or withdrawal authority

Exchange assets remain in the user's subaccount; DEX assets remain in the
user's Strategy Vault. Quant may enforce a Wallet-approved mandate but may not
hold keys, withdraw, change owner, widen risk or undo revoke.

## D-005 — Integration artifacts are proposals until owner acceptance

The contract, events and test vectors describe the Quant-owned boundary and
required owner inputs. They do not claim Wallet, Exchange, DEX, Oracle, Data
Fabric or Integration acceptance. Only 29 Integration may freeze the shared
version.

## D-006 — Evidence state is machine checked

The integration validator compares contract release booleans with
`product-release.json`, checks unique coverage/vector IDs and required fields,
requires all vectors to remain pending, and rejects central/Testnet/public
promotion without direct evidence.

## D-007 — Artifact verification is bound to an explicit release source

Desktop builds resolve a declared full Source Commit, disable implicit Go VCS
metadata, and reject any artifact-input change after that commit. Evidence-only
commits may rebuild the exact candidate; runtime or recipe drift requires a new
Source Commit and refreshed hashes. This prevents both stale-release acceptance
and false failures caused by stamping whichever HEAD runs the gate.

## D-008 — Local Preview mutation remains loopback-only in Compose

The web proxy shares the core service network namespace and reaches the API at
`127.0.0.1`; the host publishes only the web port on loopback. This preserves the
existing local Preview trust boundary instead of adding a proxy-IP bypass. Because
the web service joins the core container namespace, the supported restart sequence
is ordered `compose stop` followed by `compose up -d`, not a parallel restart.

## D-009 — Container evidence is local candidate evidence

The verified arm64 image runs non-root with a read-only root filesystem, dropped
capabilities and no-new-privileges, and passes restart plus isolated restore.
Its local image ID is not a registry manifest digest and does not imply signing,
external vulnerability scanning, immutable hosting, amd64 verification, staging
or public deployment.
