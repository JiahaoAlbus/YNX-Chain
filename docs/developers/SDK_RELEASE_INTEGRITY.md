# SDK Release Integrity

YNX Chain builds local JavaScript and Python SDK artifacts with a canonical manifest. This is a reproducible packaging and verification boundary, not proof of npm or PyPI publication.

Generate the unsigned local package set:

```bash
make sdk-release-package
```

The output under `tmp/packages/sdk-release` contains:

- a deterministic npm-compatible JavaScript `.tgz`;
- a deterministic, offline-installable pure Python `.whl`;
- `sdk-release-manifest.json` binding both package names and versions, chain IDs, `YNXT`, source commit, address-vector digest, bounded source/archive files, artifact sizes and SHA-256 values;
- an explicit `registryPublished: false` status for each package.

Verify the manifest, source checkout, archives, paths, modes, digests, package metadata, and unpublished status:

```bash
node scripts/verify/sdk-release-verify.mjs \
  --manifest tmp/packages/sdk-release/sdk-release-manifest.json \
  --artifacts tmp/packages/sdk-release \
  --source-root .
```

An owner can independently sign the exact manifest bytes with an existing Ed25519 key. The repository tooling does not generate or read the owner's private key. Verify an externally produced detached signature with:

```bash
node scripts/verify/sdk-release-verify.mjs \
  --manifest tmp/packages/sdk-release/sdk-release-manifest.json \
  --artifacts tmp/packages/sdk-release \
  --source-root . \
  --public-key owner-sdk-release-public.pem \
  --signature sdk-release-manifest.sig
```

`make sdk-release-integrity-check` performs two clean builds, compares every output digest, validates an ephemeral test-only Ed25519 signature, rejects altered artifacts/metadata/vectors/signatures, rejects extra/traversal/symlink archive entries, and installs both artifacts into isolated consumers. It performs no registry login or publication.

Publication remains incomplete until the owner approves the exact manifest, supplies registry credentials through an external protected process, publishes the same verified artifact bytes, and an independent consumer verifies the registry downloads. A local artifact, detached test signature, or readiness package must not be described as npm/PyPI publication.
