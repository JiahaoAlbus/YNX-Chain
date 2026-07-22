# Dependency and license review

The Quant Lab runtime is the repository-owned Go event engine, Go standard
library, and `gorilla/websocket` 1.5.3. The Python and TypeScript SDKs have no
runtime package dependencies. Playwright 1.58.2 is development-only. Container
files reference Go 1.25.0 and Distroless Debian 12 images, but their immutable
digests are not pinned because the local Docker build has not run; container
release remains blocked until digests and scans are captured.

All required engine candidates are evaluated in `ENGINE_EVALUATION.md`; none is
downloaded, linked, bundled, or represented as the active engine. Copyleft
engines require an attributed separately deployed process and legal review.
Projects whose current commit/license could not be reverified remain rejected.

The SBOM distinguishes required runtime, development, candidate container, and
evaluation-only components. Testnet brokerage, Wallet mandates, and live
connectivity remain fail-closed adapter interfaces; real-funds automation is
disabled. Final artifact generation must use a build-produced SBOM, dependency
vulnerability review, lockfile diff review, image scan, and provenance record.
