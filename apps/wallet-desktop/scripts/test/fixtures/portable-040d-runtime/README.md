# Portable040 normal prefix intake DATA

These tables are the actual normal materializer outputs from immutable source040d11f5b427c1836a005e77eda88a31b2428ce4, not PUBLIC-made replacement source files or a Native execution receipt. The existing materializer mechanism was reused to generate inventory/full2/product6. Embedded absolute origin paths are provenance strings only; tests never open them or require any OUT directory.

The dedicated test stages each frozen prefix row from the actual checkout and installed dependencies, verifies its exact bytes/SHA, preserves the original complete non-dependency source set, then calls the unchanged real normal-source/product readers. It creates only a private temporary Git for the Git-backed product API, not a source/release ref. It rejects root bytes, full2 and product pin drift. The fifteen finite exclusions and all fixed-Native source-only evidence remain intact. No old C1 fixtures are overwritten or rerun.

`supplier-installed-lock.json` is an explicit original supplier installed-lock DATA input. It is copied as that pinned snapshot, never falsely described as a fresh Linux npm-ci-generated lock. Every other installed/source file must match actual bytes; no mismatches are replaced or invented. Its current-checkout installed-lock equality is reported separately. The three raw runtime input dylibs must retain Git100755/mode0755. Individual source rows keep the16MiB ceiling. No Node/helper output, new Root row or actual Native qualification is carried.

From a normal checkout with the existing wallet-auth dependencies installed:

```
(cd packages/wallet-auth && npm ci --ignore-scripts --workspaces=false)
node --test apps/wallet-desktop/scripts/test/portable-040d-normal-projection.test.mjs
```

The only production delta is `sdk49-normal-profile.mjs`, containing new exact pins/constants. Normal reader functions, source-set checks and authorization checks are unchanged. This is source DATA, not fresh Native53/helper13 execution, E42, macOS13, GUI, installation or a Source/Root approval.
