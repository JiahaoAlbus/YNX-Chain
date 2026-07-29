# Next action

Rebuild and verify the current-source Android artifact:

1. Inspect `apps/video/android` build instructions, Gradle wrapper and local SDK availability without modifying unrelated worktrees.
2. Build the debug/test artifact from the current final-branch source.
3. Record exact artifact path, bytes, SHA-256, package/application ID, min/target SDK and signing class.
4. If a compatible local emulator is available, install, cold start, restart and open the registered `ynxvideo://` deep link; capture raw command evidence.
5. If the emulator or SDK is unavailable, preserve exact build/toolchain evidence, classify only the missing execution input, and continue with a product-scoped final-branch CI workflow or observability slice.
6. Update `apps/video/product-release.json`, artifact manifest, evidence index and this recovery checkpoint without claiming production signing or physical-device coverage.

After any successful modification: test, inspect diff, commit, push, verify Local SHA equals Remote SHA, then update this checkpoint.
