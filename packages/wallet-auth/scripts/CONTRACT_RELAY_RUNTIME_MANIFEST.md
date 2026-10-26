# Contract Relay runtime union generator

`build-contract-relay-runtime-manifest.mjs` is the unchanged original Auth R166 supplier: 3480 bytes, SHA256 `d1109077972c3c3097411a102fcb97bd333f1b03ea5cb0452f90e42595c94c15`. It is a manifest consistency/union tool, not an admission or grant issuer.

Use the **final matching normal SDK package's** actual canonical handoff and exact byte count/SHA. That handoff supplies the original Auth runtime manifest and WalletConnect production closure in `evidence`, with exact counts under `runtime.Auth` and `runtime.WalletConnect` and the actual `versionSDK`. Do not use the R166 parent13 example for a later package.

The CLI has exactly these three positional inputs:

```text
node build-contract-relay-runtime-manifest.mjs ABSOLUTE_CANONICAL_HANDOFF BYTES SHA256
```

The original script derives its output root from its own directory and requires the caller to create an adjacent `evidence/` first. Prefer a dedicated external generator directory: copy the script unchanged there and verify its supplier SHA, create that directory's `evidence/`, then run the CLI. This keeps generated evidence outside the already frozen installed runtime being inventoried. There is no output-root option and no need to modify the supplier script.

For example, after creating and verifying an isolated copy:

```sh
mkdir -p "$UNION_TOOL_ROOT/evidence"
node "$UNION_TOOL_ROOT/build-contract-relay-runtime-manifest.mjs" \
  "$FINAL_CANONICAL_HANDOFF" "$FINAL_HANDOFF_BYTES" "$FINAL_HANDOFF_SHA256"
```

The tool creates `evidence/manifest-XXXXXX/` containing:

- `original-ide-contract-relay-runtime-manifest.json`: canonical `{files,version}` with the established `YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1` schema, ASCII relative paths sorted once, exact byte counts and SHA256. Identical overlaps are deduplicated; conflicts and self-inclusion are rejected. Empty files require the exact empty SHA256.
- `UNION.json`: input handoff pin, original parent references, union pin/count/total bytes, deduplicated count, and the executor row from `src/walletconnect-contract-initiator-boundary.js` in those actual input manifests. The same result is printed as JSON to stdout.

`NativeAdmission`, `platformQualified`, and `network` are always `false`; `installedSourceRoot` is `null`; `normalSuccessorWillRequireRegeneration` is `true`. The tool verifies the supplied canonical handoff, manifest references, schema/version/count consistency and union rows. It does **not** independently read every runtime file, infer the installation root, establish a complete new dependency graph, or approve Root/Source/private release rows. Those remain with the normal package/closure producers and original Native qualification. The canonical handoff path is required to be absolute; the supplier does not separately require its referenced manifest paths to be absolute/normalized, so the final canonical producer must provide its actual original absolute references.

Focused tests use only tiny PUBLIC fixture manifests and isolated temporary directories. They do not import Core/Native, rerun Auth's Native parser tests, activate networking, or certify the final installed SDK union.
