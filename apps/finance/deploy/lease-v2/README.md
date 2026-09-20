# Finance single-use release tooling v2

This is an offline-verifiable Finance **deployment authorization**, independent of Central endpoint authority, Wallet Gateway VERIFIED status, Finance provider verification, and all business permissions. It does not change those states. It never enables trading or writes. No production key, signed production lease, SSH operation, deployment, gate, or trust-root installation is included in this change.

The old `signed: true` approval object, old lease files, and old remote executor are not accepted or invoked. This new executor is not installed by this repository change. It uses a separate root-owned control directory and immutable carrier location.

## Trust and signatures

`lease.schema.json` describes the envelope and `lease.mjs` provides authoritative semantic validation. Unknown fields and operations fail closed. `singleUse` is always true and `retryAllowed` false. A lease binds:

- Ed25519 key ID, trust-root version, approved digest, operation, unique ID and 256-bit random nonce;
- exact Git source/tree, archive, inventory, CycloneDX SBOM, executable and private environment hashes, for both candidate and fallback;
- host IP, machine-ID digest, independently authenticated SSH ed25519 host fingerprint and fixed service;
- current symlink target, binary, environment, state (including an explicit absent case), unit, drop-ins, entire `/etc/caddy` file inventory, UID/GID/mode, PID and restart count;
- admission-gate configuration and reviewed drain receipt, candidate and fallback `/version` response hashes, verifier/executor bytes;
- issuance, not-before and expiry, with a root maximum of at most one hour. The example root limits this to five minutes.

`candidate` is the intended target for either operation. `rollback` is the exact currently retained fallback, not an arbitrary command. A later rollback is a **new** signed lease whose candidate is a fresh immutable release of the approved historical source and whose fallback is the then-current release. For interrupted operations, `recoveryOf` identifies the unresolved consumed receipt; otherwise it is null. No old ID or nonce is reusable, even if execution failed before the first service command.

Canonicalization is this protocol's own strict deterministic JSON encoding: duplicate JSON keys rejected (including escaped aliases), plain JSON objects only, own enumerable data fields, sorted object keys with ECMAScript JSON integer-key ordering, preserved array order, no holes/accessors/symbols, well-formed Unicode and safe integers (no floats or negative zero). Depth and byte size are bounded. This is **not** a claim of RFC 8785 compatibility. `payloadSha256` hashes the UTF-8 canonical envelope with only its top-level `signature` omitted. Ed25519 signs:

```
UTF8("YNX_FINANCE_DEPLOYMENT_LEASE_V2\n" + canonical({
  algorithm, keyId, rootVersion, payload: canonicalPayloadString
}))
```

Key IDs and root versions are signature-bound, including when two public-key entries contain the same key. Key validity must cover the entire lease interval. Revoked/unknown keys, revoked root versions and clock rollback below the durable high-water are rejected. The root file is installed out-of-band by the existing authorized owner, never from a lease or transport response. Rotation requires an independently authenticated replacement public root with a monotonically increased version. Removing the durable ledger to reset the root or nonce floor is forbidden.

`trust-root.example.json` intentionally has **no key** and cannot authorize execution. Populate an externally approved Ed25519 public key as raw 32-byte base64url, canonical validity timestamps and `revoked: false`; no private material goes to the HTTP host. A public key existing in a repository does not establish Central approval. Issuance still requires the real unique owner/path lock and deployment approval applicable to the target.

## Offline issue and local verification

Node >=22 and Python >=3.9 standard libraries are sufficient; no downloaded runtime dependency is needed. `.env.example` contains path references only. An environment variable may reference a private key file; literal private key bytes in environment/arguments are not supported. Keep the PKCS8 Ed25519 file outside the repository, owned by the issuing user with mode 0600, one hard link and no symlink. Tests create only temporary `mode: fixture` keys and synthetic payloads and delete them afterward.

Prepare the draft with `draftLease` and inspect its complete digest and every baseline. Drafting only inserts an empty signature; it is not authority. For the offline CLI, all policy, digest-approval, verifier-identity and output checks precede private-key access:

```sh
node scripts/ops/finance-lease-v2/cli.mjs doctor --trust-root /secure/finance-release/trust-v2.json
node scripts/ops/finance-lease-v2/cli.mjs issue \
  --lease /secure/finance-release/reviewed-draft.json \
  --trust-root /secure/finance-release/trust-v2.json \
  --approved-payload-sha256 <independently-reviewed-canonical-payload-digest> \
  --private-key-file /secure/finance-release/offline-issuer-ed25519.pem \
  --output /secure/finance-release/new-exclusive-lease.json
node scripts/ops/finance-lease-v2/cli.mjs verify \
  --lease /secure/finance-release/new-exclusive-lease.json \
  --trust-root /secure/finance-release/trust-v2.json
```

These are reviewable future operator commands, not commands run by this change. Issuance never connects to a host. Its exclusive output must be inspected if an I/O error occurs; it cannot be silently overwritten. Local verification can additionally use `--context` containing the independently observed `host` tuple and a `minimumRootVersion`.

`transport-plan` takes the same lease/root plus `--known-hosts /secure/exact-known-hosts` and `--identity-file /secure/existing-ssh-identity`. It **only returns an argv array**; it never executes SSH. The known-hosts file must contain exactly the signed host and one independently provisioned ed25519 key, with no wildcard/alternate host and no group/world writes. The fingerprint must match. Both SSH file arguments must use a single absolute ASCII literal path: only letters, digits, dot, underscore, hyphen and slash separators are allowed; dot/dot-dot segments, doubled/trailing separators, tokens, environment references, quotes, controls and whitespace are rejected. The known-hosts path must also equal its realpath, rejecting symlink aliases. Thus the actual OpenSSH `UserKnownHostsFile` is exactly the validated literal file, never a token-expanded or whitespace-separated list. The plan uses strict checking, no host-key update, an isolated known-host file, disabled SSH config/proxies/multiplexing/forwarding, a fixed login and absolute `/usr/bin/ssh` and `/usr/bin/sudo`/Python/executor paths. OpenSSH joins the remote arguments for its remote shell; the exact remote shape contains only fixed literal tokens and the strictly validated lease ID, never a payload command or a PATH-dependent executable. There is no `eval`, shell command interpolation, payload command, arbitrary SSH option, host-key scan or accept-new fallback. Real transport and public routing changes still require the unique authorized deployment owner.

## Remote preconditions and carrier

A separate authorized installation must place `executor.py`, `cli.mjs`, and `lease.mjs` under `/opt/ynx/finance-release-v2/`. All three files and parents must be root-owned and not group/world writable. The signed verifier digest is `SHA256(lease.mjs bytes || 0x00 || cli.mjs bytes)`; the executor digest is its complete file hash. Production uses fixed `/usr/bin/node`, `/usr/bin/python3`, `/usr/bin/systemctl` and system tools provisioned by the host owner. No code is fetched from a lease.

Other fixed paths:

| Purpose | Path |
| --- | --- |
| Public trust root | `/etc/ynx/finance-release-trust-v2.json` |
| Private carrier | `/opt/ynx/leases/finance-v2/<leaseId>/` |
| Durable root-only control | `/var/lib/ynx-finance-release-control-v2/` (0700) |
| New immutable release | `/opt/ynx/releases/finance-v2/<releaseId>/` |
| Current target | `/opt/ynx/finance-current` |
| Unit | `/etc/systemd/system/ynx-finance.service` |
| Environment | `/etc/ynx/finance.env` (root-only) |
| State | `/var/lib/ynx/finance/state.json` |
| Public gate | `https://finance.ynxweb4.com/` |
| Version probe | `http://127.0.0.1:6483/version` |

The existing unit must already launch the current symlink, load the existing environment, keep its fixed state path and enforce one writer. This tool does not alter unit files, daemon-reload, Caddy, DNS, permissions, keys, default provider or business settings. The operator must bind and review the real unit/drop-ins and active Caddy configuration. The retained release's complete file set must match the rollback inventory; unexplained extra files fail closed.

Each private carrier has `lease.json`, `admission.json`, `candidate.tar`, `manifest.json`, `sbom.json`, `candidate.env`, `rollback.tar`, `rollback-manifest.json`, `rollback-sbom.json`, `rollback.env`. Environment files must be root-only; all carrier files and parents root-owned and non-writable by other users. No plaintext environment or state content is printed, placed in receipts, or returned by doctor. Private backup copies are root-only on the same host; they are **not an off-host backup**.

Archives are uncompressed USTAR regular-file inventories, at most 1024 files/128 MiB expanded, at most 64 MiB per file. Links, duplicate members, traversal, devices, extra files and PAX overrides fail before consumption. `manifest.schema.json` defines the exact file inventory; SHA-256, sizes and modes are checked before extraction. `ynx-finance` must be present and executable. SBOM bytes and source identity are signed; the tool verifies CycloneDX identity but does not assert dependency completeness from a synthetic or incomplete SBOM. A real source-linked SBOM remains an owner-reviewed input.

Only `YNX_FINANCE_WEB_DIR` may differ between old/new private env values, and it must select the signed candidate directory. All other values, including keys, remain equal. `YNX_CHAIN_ENV=testnet`, `FINANCE_TRADING_ENV=sandbox`, and all three Finance trading/live/sandbox-write switches must remain false. Environment values use simple literal systemd assignments; unsupported escaping fails closed.

### Admission is a real prerequisite

The current Finance server does not provide a verified graceful drain. This executor therefore does **not** assume SIGTERM or a public 503 alone proves quiescence. Before requesting a lease, the unique owner must close **all** Finance ingress (including API aliases and direct access), verify zero active requests and stable state, and review the complete active Caddy mapping against the bound on-disk inventory. The executor never fabricates that result or inserts a gate. The signed lease binds an owner-produced `admission.json` exactly:

```json
{
  "schema": "ynx-finance-admission/v2",
  "allFinanceIngressClosed": true,
  "activeRequests": 0,
  "caddySha256": "<exact main Caddyfile hash>",
  "caddyFiles": [],
  "leaseId": "<exact reviewed lease ID>"
}
```

`caddyFiles` must equal the complete signed auxiliary file inventory. Receipt existence is an attestation by the authorized signer, not independent proof that a route was drained. The executor also checks gate response bytes/status, unchanged configuration, current state and PID. If the owner cannot establish complete ingress closure and a zero-active-request observation, **do not issue**. The gate remains closed after success and after fallback; reopening is a separate reviewed owner step with fresh verification, never an unguarded finally block.

## Consumption, rollback-first and interruption

Remote doctor reads only; dry-run verifies signatures, host, baselines, the entire carrier/archive, rollback bytes and existing replay ledger without creating any files. Neither implies production acceptance. Execution repeats the verification under a nonblocking process-wide `flock`, rereads the durable root/clock/replay floor and current baseline, then atomically fsyncs a consumed receipt **before staging or stopping anything**. An ID or nonce already in the ledger is permanently spent. Competing callers receive BUSY or ALREADY_CONSUMED; there is no retry loop.

The rollback-first helper is the executor's bounded state machine: verified retained rollback inventory → durable consumption → private env/baseline backup → exact candidate extraction → fresh baseline/signature/expiry check → stop the sole writer → verify stopped and state unchanged → private state backup if present → atomic env/current switch → start the same unit → exact `/version`, running `/proc/PID/exe`, env/unit/Caddy/state checks. It has no dependency on the old executor. Every state transition is fsynced; state is never restored or migrated. There is no account/funding/provider/business action.

On a determinate candidate failure, unchanged state and closed ingress permit restoring only the previously verified binary target and env. The old source/version must verify before recording FAILED_ROLLED_BACK. If stop/start outcomes are uncertain, state changed, the gate/config changed, or fallback verification fails, execution records AMBIGUOUS_REQUIRES_NEW_RECOVERY_LEASE and performs no blind retry. Any process crash leaves its consumed phase in the ledger, including a crash after VERIFIED but before final receipt. Ledger loss/rollback cannot be detected without an external owner-held checkpoint: keep this root-only ledger on durable local storage and do not restore old copies. No claim of hardware-backed rollback resistance is made.

Doctor reports the exact stored phase without keys, secrets, or mutation. An unresolved consumed/ambiguous operation blocks even an unrelated new deploy. Recovery requires a new operation `rollback`, ID, nonce, current exact baseline, and `recoveryOf` referencing that unresolved entry. It may explicitly bind an inactive service with PID 0. Once the new lease is consumed, the predecessor records RECOVERY_AUTHORIZED and its successor ID; this does not assert recovery succeeded. New success/failure is recorded separately. For a partially switched environment/link that does not form a coherent signed baseline, first diagnose and obtain an explicit owner recovery plan; this tool deliberately will not guess or restore state to make validation pass.

Future installed commands, run only by the unique authorized owner:

```sh
/usr/bin/python3 /opt/ynx/finance-release-v2/executor.py doctor
/usr/bin/python3 /opt/ynx/finance-release-v2/executor.py dry-run --lease-id <new-id>
/usr/bin/python3 /opt/ynx/finance-release-v2/executor.py execute --lease-id <new-id>
```

The trusted platform clock is an operational prerequisite. Lease windows are checked locally and remotely and again immediately before stopping; durable time/root floors prevent observed rollback. This is not an independent time oracle and does not protect against a root administrator rolling back the clock and ledger together. No network time/signing service is contacted by the tool.

## Controlled tests

```sh
node --test apps/finance/deploy/lease-v2/lease.test.mjs
# or: cd apps/finance/deploy/lease-v2 && npm test
```

Tests use ephemeral fixture roots with a marker, generated temporary fixture-only keys, a virtual service and synthetic state/env/version responses. They cover cryptographic tampering and relabeling; expired/future/no clock; wrong host/root/key/rollback/operation; issuer guards before key access; local host fingerprint and connection-free `ssh -G` effective-path checks; exact absolute remote-command shape; dry-run; full artifact and configuration drift; new Caddy includes/open admission; secret preservation; archive paths/symlinks/duplicates; concurrent processes; durable ID/nonce/root/time floors; every phase crash; ambiguous command outcomes; preservation of newly changed state; bounded binary/env fallback; inactive-writer fresh recovery. No fixture is a real lease, public deployment, provider verification, live trade or product E2E acceptance.
