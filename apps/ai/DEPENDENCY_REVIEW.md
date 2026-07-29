# YNX AI dependency and license review

Reviewed on 2026-07-29 for the independent YNX AI source and preview APK.

- `go list -m -json all` and `pnpm list --json --prod --depth Infinity` are the
  authoritative dependency inputs for `sbom.cdx.json`.
- `pnpm licenses list --json --prod` completed successfully. Reported license
  groups were MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, MPL-2.0,
  Python-2.0, Unlicense, CC-BY-4.0, BlueOak-1.0.0, 0BSD, and dual-license
  expressions. No AGPL-only, SSPL-only, BUSL-only, or unlicensed production
  package group was reported.
- `go test ./...`, targeted AI race tests, targeted AI `go vet`, Expo Android+iOS
  bundle export, Android lint vital, APK signature verification, repository
  secret scan, and placeholder scan passed for the reviewed source state.
- `pnpm audit --prod --audit-level high` reported no known mobile production
  vulnerabilities after the bounded `brace-expansion` and `uuid` overrides.
- Go uses the `go1.25.12` toolchain. Targeted `govulncheck` for the AI product,
  Gateway, daemon, and app reported 0 reachable vulnerabilities. Imported or
  required modules may still have advisories outside the reached AI call graph;
  this is not a repository-wide no-vulnerability claim.
- Root Hardhat tooling remains development-only. `npm audit --omit=dev` reported
  0 vulnerabilities; full development audit still reports the upstream
  `hardhat` → `adm-zip` advisory with no available fix.
- The preview APK is debug-certificate test-signed. This review is not legal
  advice and does not promote the artifact to production-signed or store-ready.

Regenerate before release:

```sh
node apps/ai/scripts/generate-sbom.mjs
pnpm --dir apps/ai/mobile licenses list --json --prod
```
