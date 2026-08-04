# Secure strategy runtime

The current worker deliberately supports only the owned deterministic
`ynx-built-in-ma-v1` runtime. It does not import or execute user Python, native
libraries, shell commands, WASM, or arbitrary source.

Every job must bind:

- Ed25519 signer key ID and valid manifest signature
- package ID/version and exact runtime
- source identity SHA-256 and canonical request/artifact SHA-256
- every dependency name/version/SHA-256/license from an operator allowlist
- passed malware and secret scan evidence with scanner version/evidence hash
- deterministic clock and checkpoint/recovery capability
- CPU, memory, wall-time, and maximum-input declarations within engine ceilings
- `false` host filesystem, arbitrary network, Wallet-key, and provider-secret
  permissions

The worker's only filesystem access is its operator-mounted inbox/outbox and
integrity-protected state path. Its built-in runtime performs no network call.
Container candidates drop capabilities, use a read-only root filesystem, run as
non-root, and mount only required state. Package failure returns a rejection and
does not move the request into completed evidence.

Future user-code execution requires a separately reviewed container or WASM
sandbox with enforced cgroup/job-object limits, no-follow file access, network
deny-by-default, deterministic host calls, checkpoint interruption tests, image
digest/SBOM/provenance, and escape/side-channel testing. It cannot reuse the
current built-in-runtime approval as sandbox evidence.
