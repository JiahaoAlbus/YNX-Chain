# Next Action

Current single action: make the JavaScript and Python SDK release process reproducible and independently verifiable without publishing unapproved packages.

Why this action:

- Commit `563fe1f36918` completes the local deterministic BFT boundary for sponsored resource pools and passes the full preflight suite.
- Remote BFT promotion is correctly blocked on external owner handover, offline recovery, independent custody review, and exact transaction approval; those facts cannot be manufactured in code.
- The SDKs have tested local clients and live read-only compatibility, but still lack a canonical release manifest, signed versioning, registry publication, and independent clean-consumer evidence.
- Reproducible artifacts and detached-signature verification can be implemented and tested locally without registry credentials or private signing keys.

Required behavior:

- Define one canonical SDK release manifest binding chain IDs, native symbol, package names, semantic versions, source commit, shared address-vector digest, artifact filenames, artifact SHA-256 values, and build commands.
- Produce deterministic JavaScript and Python source/package archives from a clean tracked-file set with normalized ordering, timestamps, ownership, and permissions.
- Verify that manifest metadata matches both package definitions and that artifacts unpack to the expected bounded files without path traversal, extra files, symlinks, or generated secret material.
- Add detached-signature support that accepts an owner-provided public key and signature file, verifies the exact manifest bytes, and never generates, reads, or stores an owner private key.
- Add clean temporary-environment consumer tests that install only the produced artifacts, import both SDKs, verify chain metadata and shared address vectors, and exercise mocked REST/EVM error and timeout behavior.
- Keep npm/PyPI publication as a separate owner-approved operation. Local package generation must never be labeled registry publication.
- Wire focused checks into `make test` or `make preflight`, package/readiness outputs, and API/developer documentation only after the implementation exists.

Files to touch:

- `sdk/js` and `sdk/python`
- `testdata/address-vectors.json`
- `scripts/package` and `scripts/verify`
- `Makefile`
- SDK/developer and acceptance documentation after real code and tests exist

Validation commands:

- focused deterministic build, tamper, traversal, metadata-mismatch, detached-signature, and clean-consumer tests
- a dedicated SDK release-integrity Make target
- `make sdk-check`
- `make address-codec-check`
- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Two clean builds from the same tracked source produce byte-identical JavaScript and Python artifacts and an exact canonical manifest.
- Any changed artifact, metadata field, vector, signature, unexpected archive entry, or package content fails closed.
- A clean consumer installs both local artifacts and passes bounded SDK/address/metadata tests without importing source directly from the repository.
- Status remains package-ready/local-only until owner-approved npm/PyPI publication and independent registry-consumer proof actually occur.

Explicitly not doing:

- No npm/PyPI login, publication, namespace claim, package overwrite, or owner-signing-key generation without explicit owner approval.
- No claim of registry publication, wallet default support, exchange listing, stablecoin issuer support, partnership, mainnet launch, or public BFT completion.
- No public BFT freeze, signer install, ingress switch, or cutover without the existing custody, recovery, independent-review, and transaction approvals.
- No expansion of bounded EVM opcodes, Counter/Hardhat artifacts, or IDE execution.
- Do not modify or replace the long-term goal file.
