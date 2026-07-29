# YNX Video evidence index

- `media-smoke.json`: real loopback ClamAV/FFmpeg/HLS lifecycle using owned media.
- `RECOVERY_AND_AUDIT.md`: persistence, idempotency, backup/restore and limits.
- `MEDIA_INTEGRITY.md`: source-bound HLS asset hashes, bytes, lineage, schema v2 migration and fail-closed legacy backfill evidence.
- `clamav-readiness-20260729.txt`: read-only proof that the executable exists but updater configuration and signatures are unusable; Testnet remains false.
- `backup-restore-20260729.txt`: current-source CLI build, measured backup/restore, matching state hashes and restored-store reopen evidence.
- `test-gates.txt`: exact local gates and the unchanged full-repo baseline failure.
- `artifact-manifest.json`: exact local build hashes, sizes and signing classes.
- `android-final/`: exact debug APK install, launch, deep link, restart and signing.
- `ios-feasibility.txt`, `ios-simulator-deep-link.png`: successful remote Simulator
  build/install/cold/restart and registered-scheme dialog, with explicit limits.
- `UI_DESIGN_AUDIT.md`, `ui-audit-current/`, `ui-audit-after/`: baseline and remediated Web evidence.
- `SBOM_AND_LICENSE.md`: source dependency, tool and owned-media boundary.

The authoritative release truth is in `apps/video/product-release.json` and
`apps/creator-studio/product-release.json`. Empty public/artifact URL arrays and
false central/staging/public/signing/store flags are intentional.
