# SBOM and license boundary

The YNX Video Go service imports only Go standard-library and repository-internal
packages. Both Web packages have no npm runtime dependencies, and the Android app
has no external Maven runtime library. The iOS project uses Apple system frameworks.

ClamAV 1.5.3 and FFmpeg 7.1.1 were local operational tools for the recorded smoke;
they are not bundled in the APK, Web source or Go binary. A production image must
pin, scan and review their exact packages, signature database, codecs and licenses.

The MP4 fixture is repository-owned test media with provenance in
`internal/video/testdata/README.md`; it is not licensed public catalog content.
No third-party interface assets or protected media were added. This review is a
source-bound engineering inventory, not external legal approval.
