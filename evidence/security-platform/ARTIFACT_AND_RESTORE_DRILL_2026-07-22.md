# Artifact and Restore Drill — 2026-07-22

## Reproducible artifact

- Source commit: `850b2e31e3ba7507c73c271bf4737922d3f609eb`
- Artifact: `ynx-security-platform-850b2e31e3ba7507c73c271bf4737922d3f609eb.tar`
- Bytes: 440,320
- SHA-256, build one: `37ec8070947ec977af99588366c7f372c9ffa6ae62ffcf0b8ecf7e220350f15b`
- SHA-256, independent build two: `37ec8070947ec977af99588366c7f372c9ffa6ae62ffcf0b8ecf7e220350f15b`
- CycloneDX SBOM components: 345
- CycloneDX SBOM SHA-256, both builds: `c890868b4163e380ed130ef7dddc693477303cc820f44bd02c33e8a3479b1069`
- Provenance SHA-256, both builds: `3cbafd761cfbcde3cd6e177496fa1519c8860488813cb532dc3d4b2fa5f2edaf`
- Signature: Ed25519 detached test signature, verified
- Test public-key fingerprint: `sha256:026e2dad21177a5463028601ac1650ab31839351de1ccc776f0da76cead3d5b8`
- Signing class: `test-signed`
- Public release eligible: false
- Archive path traversal scan: PASS
- Archive private-key header scan: PASS
- Archive secret-file extension scan: PASS

The ephemeral private key was created in a system temporary directory with owner-only permissions and was never copied into the repository. This drill does not support `productionSigned=true` or `downloadHosted=true`.

The earlier `e2c2924` candidate remains in the registry as revoked evidence. It was superseded after dependency advisory remediation and after the archive was made self-contained; it is not an active release candidate.

## Encrypted restore

- Source set: versioned security-platform policy and secret metadata files
- Algorithm: AES-256-GCM
- Encrypted backup SHA-256: `9e812690703e8eee9765b95ffe5b3b15344692fb4684a28fcc7c365559b7d7c1`
- Encrypted bytes: 3,018
- Files: 2
- Restore comparison: exact recursive diff passed
- Reported local duration: under one second
- Signer recovery included: false

The runtime key was held only in a system temporary directory and was not printed. This is a component-level local drill, not proof of an atomic production snapshot, immutable/offline storage, cross-region recovery, or the declared four-hour RTO and 24-hour RPO.
