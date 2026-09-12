# Exchange mobile XML dependency owner checkpoint

This inherits the unfinished Exchange dependency fix on owner baseline
`8dc67ca003cd2b6ecde9a21b8f1e4c2564d161ad`. The ecosystem fix already exists at
`230989b778606ffd4df7fe3cb1e18ab07fd4a152`; this checkpoint preserves the newer
Exchange owner manifest, Swift compatibility postinstall, existing overrides
and Wallet vendor record.

Only `@expo/plist -> @xmldom/xmldom` (0.8.13 to 0.8.15) and
`plist -> @xmldom/xmldom` (0.9.10 to 0.9.12) change. Parent-qualified overrides
fit the existing `^0.8.8` and `^0.9.10` ranges. Every other lock node remains
unchanged; each changed node differs only in version, resolved URL and integrity.
The unrelated `vendor/wallet-auth` record removed during the initial npm lock
refresh was restored byte-for-byte before clean-install validation.

## Verification on 2026-09-12

- Node v26.7.0; npm 11.19.0; macOS host.
- `npm ci --no-audit --registry=https://registry.npmjs.org`: exit 0, 504 packages.
- Installed dependency readback: 0.8.15 and 0.9.12.
- `npm run check`: exit 0; typecheck, 13/13 tests, 12-locale/59-key/Arabic RTL
  audit, Android and iOS Hermes export passed.
- Structural comparison to owner baseline: exactly two changed lock nodes;
  all other nodes and all tracked vendor files unchanged. `git diff --check` passed.
- npm reported existing uuid deprecation and install-script allowlist warnings
  for esbuild/fsevents. No global dependency-clean claim is made.

| Output | Bytes | SHA-256 |
|---|---:|---|
| package.json | 1348 | 35c2f2cbcf5ce4df242d4dd515522e670120dfd1a1cea41b1de4cef57cf0f009 |
| package-lock.json | 257964 | 12b60ca5fb2da58bc8d762d2884c69f8dde9e7f8faef11e023e3806caf5f3cf2 |
| dist/_expo/static/js/android/index-beb63a8ac587e637aadc7b7c6fad45e2.hbc | 4108686 | 765ecb450916a4ffe8f023d28f7e24c68973be030afcfaae8e1b12696800470a |
| dist/_expo/static/js/ios/index-191a38271975426e91edb11b4b9812ab.hbc | 4103359 | 6bed035a6e20cf1b8cfd3b38f2e040154cb9f1d6b560fcb7e2e38e44f7cd7bd0 |
| dist/metadata.json | 244 | cf66cd86482c99ee1172e5fdd18d14c5d8ac107ec118be7fa130d72986a4e32e |

The source identity is the commit adding this record and its two manifest files;
it is deliberately not self-referenced inside the record. These exports are
local build outputs, not APK/IPA installers. Central/main integration, public
deployment, installed runtime, approval, signing, orders/transactions and alert
closure remain unproved for this fix. No shared SDK or product trading logic
was changed.

Central should apply only the Exchange owner change onto the chosen release
lineage, resolving overlap with the existing ecosystem security commit; do not
replace newer owner files with older branch copies. Revert the commit adding
this record to restore the prior dependency graph (including its known affected
versions); no database migration or runtime rollback was performed.
