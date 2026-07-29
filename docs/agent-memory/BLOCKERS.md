# Blockers

## Execution infrastructure

### VID-INFRA-CLAMAV

- Owner: local execution environment
- Evidence: `docs/handoffs/video-evidence/clamav-readiness-20260729.txt` records ClamAV 1.5.3, an unparsable `/opt/homebrew/etc/clamav/freshclam.conf`, and no supported database files in `/opt/homebrew/var/lib/clamav`.
- Impact: the complete current-source Upload → Scan → Probe → Transcode → HLS → Publish → Play loop cannot be marked Testnet verified.
- Product behavior: fail closed; scanner unready does not become a product success.
- Autonomous work remaining: retry the loopback E2E only after valid scanner configuration/signatures exist; continue all independent product-owned work now.
- Recovery condition: scanner readiness passes and the owned-media loopback E2E succeeds against the current source SHA.

## Cross-product acceptance

### VID-INT-001

- Owners: YNX 02, 04, 15, 26, 29 and 30
- Evidence: `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- Impact: `integratedCentral` and shared `testnetVerified` remain false.
- Preparation completed: Integration Contract v2, exact registrations, gateway manifest and cross-product vectors are source-bound and pushed.
- Minimum external input: authoritative acceptance results or rejection details from each owner.
- Recovery condition: YNX 29 records exact accepted versions and shared-testnet vector results.

## Release infrastructure

### VID-REL-001

- Owners: YNX 30 / release owner / website owner
- Evidence: `apps/video/product-release.json`
- Impact: no current-source native artifact, hosted download, staging/public runtime, production signing, physical-device proof or store release.
- Preparation completed: truthful release record separates current source from historical debug/simulator artifacts.
- Minimum external input: only after autonomous artifact rebuild and release gates are complete—signing custody, deployment target and store credentials.
- Recovery condition: source-bound artifacts, SBOM/provenance, install evidence and public probes pass their owner gates.

## Not classified as product external blockers

The lack of a current final-branch GitHub Actions run and the local ClamAV configuration are active engineering/infrastructure work, not excuses to mark YNX Video externally blocked or complete.
