# Grok Build integration record

YNX AI Build can use the official `xai-org/grok-build` command as an optional,
user-approved ACP sidecar. It is not bundled, vendored, downloaded, enabled, or
trusted by default. YNX does not use the Grok or xAI logo and does not imply an
affiliation, endorsement, or compatibility certification.

## Audited upstream

- Repository: `https://github.com/xai-org/grok-build`
- Exact commit: `98c3b2438aa922fbbe6178a5c0a4c48f85edc8ce`
- Git tree: `b40a1962cb8061b85c2354850ab4d5707f48414b`
- Upstream `SOURCE_REV`: `124d85bc5dc6e7805560215fcc6d5413944920e1`
- Upstream version: `0.2.102`
- Deterministic `git archive --format=tar` SHA-256:
  `5d9cd70fb23fa2d0ada9b05b8d381b73a50cf535d38a8f0ad00c9d1daf9db31f`
- Root license: Apache-2.0; copyright 2023–2026 SpaceXAI.
- Root `LICENSE` SHA-256:
  `116f7778b9802e569b7fa3a532b17bd80eb13c67837def01eed093d4ea472f28`
- Root `THIRD-PARTY-NOTICES` SHA-256:
  `7b7c315403c596f9b7a13bb562553ee4fd4c05da8672f95bcaa02a125eea2947`
- `third_party/NOTICE` SHA-256:
  `4122c27e9ad4b8e67e6f8a7869d11f389600a5d5f773fdec9d0b2ac9d7f21101`
- `Cargo.lock` SHA-256:
  `7141e692962fea8a061136f67f1f8d51c7027cd1bb9f215b06f13c6105157bf5`

The exact source was inspected from a detached clone. Source compilation was
not completed on this macOS host because Rust 1.92, Cargo and DotSlash were not
installed. `protoc` was present. This is recorded as a limitation rather than
replaced with a synthetic build result.

## Adapter boundary

`desktop/grok-build-sidecar.mjs` accepts only an operator-provided executable
path and a separately trusted SHA-256. It verifies executable access, exact
checksum and exact `0.2.102` version output before starting `grok agent stdio`.
The child is launched without a shell and with an empty environment. JSON-RPC
lines are size-bounded; client methods are allowlisted; agent permission
requests deny by default; cancellation and shutdown are explicit; audit entries
are retained by YNX AI Build.

The adapter is an interoperability layer only. YNX AI Build owns plan review,
context selection, permission decisions, diff approval, checkpoints and audit.
The sidecar cannot receive Wallet keys, PEM material, deployment signers,
service secrets, unchecked files, Git push or deployment authority.

## Update and rollback

An upstream change requires all of the following before the pin moves:

1. Fetch a named commit/tag and verify its Git identity and archive checksum.
2. Diff root license, third-party notices, `third_party/NOTICE`, manifests and
   locked dependency graph.
3. Re-run version verification, ACP lifecycle, default-deny permission and
   cancellation tests against the candidate binary.
4. Review protocol/method changes and refuse unknown requests.
5. Retain the prior approved checksum and pin as the rollback record.
6. Rebuild SBOM, source manifest, notices and release evidence.

No automatic sidecar update or unsigned update path exists.
