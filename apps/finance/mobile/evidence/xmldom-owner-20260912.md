# Finance mobile XML dependency owner checkpoint

This inherits the unfinished Finance dependency fix on owner baseline
`8dc67ca003cd2b6ecde9a21b8f1e4c2564d161ad` without changing Wallet SDK bytes or
product behavior. The ecosystem fix already exists at
`230989b778606ffd4df7fe3cb1e18ab07fd4a152`; this checkpoint preserves the newer
Finance owner lineage and pins the two parent dependency routes.

Only `@expo/plist -> @xmldom/xmldom` (0.8.13 to 0.8.15) and
`plist -> @xmldom/xmldom` (0.9.10 to 0.9.12) change. The versions satisfy the
existing `^0.8.8` and `^0.9.10` ranges. Parent-qualified overrides prevent a
future lock refresh from selecting the affected versions. Every other lock node
is unchanged; each changed node differs only in version, resolved URL and
integrity. Resolved tarballs use the official npm registry.

## Verification on 2026-09-12

- Node v26.7.0; npm 11.19.0; macOS host.
- `npm ci --no-audit --registry=https://registry.npmjs.org`: exit 0, 492 packages.
- Installed dependency readback: 0.8.15 and 0.9.12.
- `npm run check`: exit 0; typecheck, 9/9 tests, endpoint manifest verification,
  Android and iOS Hermes export passed.
- Endpoint manifest SHA-256: `3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5`.
- Structural comparison to owner baseline: exactly two changed lock nodes;
  all other nodes and all tracked vendor files unchanged. `git diff --check` passed.
- npm reported existing uuid deprecation and install-script allowlist warnings
  for esbuild/fsevents. No global dependency-clean claim is made.

| Output | Bytes | SHA-256 |
|---|---:|---|
| package.json | 1250 | 30d153d65b29ff7b0b4960f75e259f2a378fb7d39c2a9a72fa1f472540e13260 |
| package-lock.json | 251187 | 7e08b034acbfa6b052eaeb5aa70d268305782cfbbc1c65a3327cae56272121dd |
| dist/_expo/static/js/android/index-1ab7a5799040f3bf2cba1c185c807626.hbc | 3563091 | 446c96aecf91e902f3c131ff89968418e986f75b37d7c92c02d1f6cd82378f35 |
| dist/_expo/static/js/ios/index-e461df063735dbcdeb3f339d4403bfd3.hbc | 3557811 | 2191458a538f6d5aabe513c8aed94622e5a0e2ed8da1278c417a0d2435ce2bd7 |
| dist/metadata.json | 244 | cc215eb34db321caa397cde8eaa5f34210d8ff232665804d316b5c44b51d93e4 |

The source identity is the commit adding this record and its two manifest files;
it is deliberately not self-referenced inside the record. Exports are local build
outputs, not APK/IPA installers. Existing installed or hosted artifacts were not
updated. Central/main integration, public deployment, installed runtime,
approval, signing, transactions and alert closure remain unproved for this fix.

Central should apply only the Finance owner change onto the chosen release
lineage, resolving any overlap with the existing ecosystem security commit;
do not replace newer owner files with older branch copies. Revert the commit
adding this record to restore the prior dependency graph (including its known
affected versions); no database migration or runtime rollback was performed.
