# YNX Video evidence index

- `media-smoke.json`: real loopback ClamAV/FFmpeg/HLS lifecycle using owned media.
- `RECOVERY_AND_AUDIT.md`: persistence, idempotency, backup/restore and limits.
- `test-gates.txt`: exact local gates and the unchanged full-repo baseline failure.
- `artifact-manifest.json`: exact local build hashes, sizes and signing classes.
- `android-final/`: exact debug APK install, launch, deep link, restart and signing.
- `ios-feasibility.txt`: local Swift/project checks and the unexecuted CI boundary.
- `UI_DESIGN_AUDIT.md`, `ui-audit-current/`, `ui-audit-after/`: baseline and remediated Web evidence.
- `SBOM_AND_LICENSE.md`: source dependency, tool and owned-media boundary.

The authoritative release truth is in `apps/video/product-release.json` and
`apps/creator-studio/product-release.json`. Empty public/artifact URL arrays and
false central/staging/public/signing/store flags are intentional.
