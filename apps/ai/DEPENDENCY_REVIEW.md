# YNX AI dependency and license review

Reviewed on 2026-07-19 CST for the independent YNX AI source and preview APK.

- `go list -m -json all` and `pnpm list --json --prod --depth Infinity` are the
  authoritative dependency inputs for `sbom.cdx.json`.
- `pnpm licenses list --json --prod` completed successfully. Reported license
  groups were MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, MPL-2.0,
  Python-2.0, Unlicense, CC-BY-4.0, BlueOak-1.0.0, 0BSD, and dual-license
  expressions. No AGPL-only, SSPL-only, BUSL-only, or unlicensed production
  package group was reported.
- `go test ./...`, `go vet ./...`, Expo Android+iOS bundle export, Android lint
  vital, APK signature verification, repository secret scan, and placeholder
  scan all passed for this source state.
- The preview APK is debug-certificate test-signed. This review is not legal
  advice and does not promote the artifact to production-signed or store-ready.

Regenerate before release:

```sh
node apps/ai/scripts/generate-sbom.mjs
pnpm --dir apps/ai/mobile licenses list --json --prod
```
