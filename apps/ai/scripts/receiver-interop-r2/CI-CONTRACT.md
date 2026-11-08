# Portable receiver-purpose candidate test, r2

This is a test-only successor of LINK `qualified-receiver-candidate-r1-U3Q8nb/HANDOFF.json` (14439 bytes, SHA256 `2c2c9604c98e234fb04eae0fe27e615632a20eb1bcef49258c01ad4b4c824aa5`). The old H and its actual race PASS stay immutable. This portable successor has **not run Go**. No new Root row, receiver permission, Source getter or production runner is implemented here.

Apply only the four `go/` files at their relative paths to the original P08/Auth matching source graph. The actual production runtime/local packages must be the Auth receiver `frozen-r2-zUASUg` six-delta CAS, with the original normal P08 consumer and LINK continuation transport. This package is not a replacement source graph. Both Go build tags are mandatory: `link_registered_receiver_interop,link_receiver_purpose_candidate`. Run only `^TestLINKP08QualifiedReceiverPurposeCandidate$`; do not run supplier/old consumer suites merely to consume this package.

The two top-level JS assets **must** travel with the four Go files: `public-fixture.mjs` and `public-preload.mjs`. The Go fixture copies them into each local PUBLIC facts directory. `PUBLICSDKRoot` is an extra field only in that directory's `PUBLIC-facts.json`. Both fixture-generation and the preload recover the SDK path from this file, so the unmodified production qualification runner can retain `cmd.Env=[]`. It is not inserted in the normal runner's input JSON or signed scope. The production runner's bytes/SHA remain `6daec82a7bc430f000bb4c59f44c9691728f4e17cf5138d7206ec61fef3d3dcd`.

## Exact supplier staging

`ORIGINALS.json` binds the Auth H, unchanged Auth runner, SDK d269 source/hosted H, canonical package TGZ and six bundle origins. The actual soleSDK source is commit `d269e8798fdcdc55379760a90fa1813550177591`; canonical TGZ SHA256 `83d5a1e90285c07f573f2f059d354a08c4556719b6f67b5c9f53174a6a56913f`. Use the existing soleSDK download/integrity/extraction pipeline. This helper does not download, install, compile or authenticate a replacement SDK.

`prepare-public-runtime.mjs` is the mechanical portable form of Auth's supplied `reproduction/prepare-public-runtime.mjs` (its exact origin pin is in ORIGINALS). It requires:

- The already verified canonical SDK package root: JS/JSON under `native/`, `src/`, plus package-level JSON.
- Only the six actual bundled providers: `@ynx/batch-v01-candidate`, `@ynx-chain/open-protocol`, `@noble/hashes`, `@noble/curves`, `@noble/ciphers`, `@noble/post-quantum`. No wildcard copy of workstation `node_modules`.
- The two **unaltered** soleSDK PUBLIC test fixtures, mirrored in `sdk-fixtures/` with source/bytes/SHA pins: `task-read-receiver-source.fixture.mjs` and `source-v2-public.fixture.mjs`. They are not normally shipped as package runtime files and must not be silently omitted. No fixture crypto implementation is rewritten.
- The exact Auth qualification runner supplied by the real r2 H.

The stager verifies the nine required SDK originals, both fixture originals and runner before output creation, and records actual copied file hashes in `PUBLIC-RUNTIME-STAGING.json`. It then emits `PUBLIC-runtime-inventory.json` for the existing Go held-file path. This is PUBLIC test runtime staging, not a Root-selected release. It copies these named SDK families, not the 4633-file original composite source tree. Staging does not independently re-prove every TGZ/bundle entry; that remains the existing SDK supplier intake.

## Environment and command contract

CI owns pre-created, canonical absolute directories; do not point outputs at another owner's source. Protected fixture/runtime/test-executable directories must be below a safe owned ancestor chain (normally an explicit private directory below canonical `$HOME`), with 0700 at the fixture root. The original Auth safeInfo guard remains unchanged. Compiler caches, `GOTMPDIR`, permanent evidence and source copies stay in the CI-owned external/runner scratch. A writable mount ancestor such as the original external volume's 0775 root is correctly refused by Auth; do not chmod that mount or weaken safeInfo.

Required variables:

- `PUBLIC_RECEIVER_NODE`: canonical absolute executable Node path, explicitly derived by CI (for example `node -p 'require("node:fs").realpathSync(process.execPath)'`), not a Homebrew path literal.
- `LINK_RECEIVER_CANDIDATE_SOCKET_ROOT`: pre-created canonical 0700 safe fixture root; the P08 projection, registration/socket parent, PUBLIC facts and tiny Node wrapper are created here.
- `PUBLIC_RECEIVER_RUNTIME`: canonical staged runtime root returned by the following command.
- `LINK_RECEIVER_CANDIDATE_ASSETS`: canonical absolute directory containing the two top-level PUBLIC JS assets from this package.
- `LINK_QUALIFIED_RECEIVER_EVIDENCE`: CI-owned permanent evidence directory.

Given already pinned inputs and owned directories, stage with:

```sh
node "$TEST_PACKAGE/prepare-public-runtime.mjs" "$VERIFIED_SDK_ROOT" "$TEST_PACKAGE/sdk-fixtures" "$SAFE_PARENT" "$EXACT_AUTH_RUNNER" "$EVIDENCE"
```

Use stdout as `PUBLIC_RECEIVER_RUNTIME`. The package locations and absolute tool paths are supplied by the CI caller; this package contains no active workstation path assumption.

To keep compiler work outside the safe runtime directory, the original P08 CI can build **one test executable**, then copy only that completed executable into its own safe directory:

```sh
go test -mod=readonly -race -p 1 -c -tags=link_registered_receiver_interop,link_receiver_purpose_candidate -o "$EVIDENCE/receiver.test" ./internal/aiproduct
cp "$EVIDENCE/receiver.test" "$SAFE_PARENT/receiver.test"
chmod 700 "$SAFE_PARENT/receiver.test"
"$SAFE_PARENT/receiver.test" -test.run '^TestLINKP08QualifiedReceiverPurposeCandidate$' -test.timeout=90s -test.v
```

The owner must retain exact build/exit/signal/stdout/stderr and source-before/after evidence, hash the completed executable and the safe copy as identical, require exactly 1 RUN/PASS and zero failure/skip, and await actual process/child closure before deleting only its own transient directory. Keep UNKNOWN debt and original errors; never infer Source admission from the exit code. No compiled Go archive or second production runtime is introduced.

## Verification boundary

Portable source formatting plus Node syntax and five metadata/FS controls passed locally. No Go build/test, fixture math, PQ or new network execution was run for this successor. Its real Go/Node24 execution belongs to the original P08/Auth CI after Root releases the actual heavy slot. Original single-top race PASS is evidence for the preceding source tuple only.

The candidate test checks genuine concrete typed-purpose math/current via the original PUBLIC SDK fixture, real Owner methods, normal P08 constructor, actual LINK Unix listener/dial/Join/Close, and the real P08 direct ReadInput Source-child debt after network drain. It sends no HTTP business request and executes no C/D/F or Store effect. Production zero-argument rows remain empty. Root/Source/Native/business admission, deployment and real registration remain false.
