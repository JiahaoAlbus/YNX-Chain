# PUBLIC22 preparation blocker and narrow successor fix

The first installed22 GUI attempt displayed `bootstrapFailed` almost immediately, before a WK view/search was observed. Its before/after/quit backend snapshots were empty; those snapshots do not establish whether a process briefly existed. The original GUI result and all22 artifacts remain unchanged.

An actual no-network callee reproduction loaded the installed pinned supply, created a fresh synthetic scratch directory, then failed at `profile.prepare` with `BundledTorBackend.unsafeProfile` (NSError code4). The returned path was `/var/folders/...`. On this macOS, Foundation `resolvingSymlinksInPath()` abbreviates the underlying `/private/var/...` back to `/var/...`; `/var` is a symlink. The shared loader correctly rejects it while walking every ancestor with `O_NOFOLLOW`. This reproduces a concrete pre-launch blocker consistent with the GUI symptom; the original GUI's discarded NSError is not retroactively claimed as captured.

The successor changes only `TorPublicSearchDiagnostic.swift`: create/open the fresh scratch inside the valid mkdtemp buffer lifetime, obtain its vnode path with public `F_GETPATH`, construct a filesystem URL without Foundation re-normalization, then re-open every component with NOFOLLOW and compare dev/inode/uid/exact0700 against the original descriptor before returning. The shared supply/profile loader, backend bytes and private/production gates are not weakened. The descriptor binding is the creation/check boundary, not a new interprocess permission or ongoing hostile-same-user isolation guarantee.

The fixed actual installed-supply preparation now returns `/private/var/...`, prepares the profile and encodes configuration. It does not run the adapter, vendor, WK or network. In fresh test directories, the actual validator rejects a different inode and a symlink replacement; the unchanged shared loader also rejects that symlink. All generated test directories and original failures are retained.

The same diagnostic file records first-stage/error information without a new framework: supplyLoad, scratchCreate, profilePrepare, backendLaunch, bootstrap, contentRules, webViewCreate and fixedDocumentLoad. First NSError domain/code, known typed failure, observed original PID, exit status and a fixed allowlist of adapter stop reasons form a bounded UI summary. No localized message, userInfo, failing URL, bridge or raw stderr is read/printed. The original typed first error is sticky across cleanup. Missing profile preparation is now `profileRejected`; adapter-call throws are `backendLaunchRejected`; observed early exit is `backendExited`; TLS URL errors are distinguished from other URL/network errors. Existing adapter.start still includes its own validation/config/spawn work: a thrown API error is not falsely called a confirmed spawned child. Existing adapter exposes exit status but not terminationReason, so no signal is guessed. Raw Arti pipe output is still unavailable; it is not invented from a UI label.

New CI commands (fresh outputs, macOS, jobs1, architecture selected by platform.machine):

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_public_search_scratch_delta.py "$RUNNER_TEMP/ynx-public-scratch-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_public_search_failure_stage.py "$RUNNER_TEMP/ynx-public-failure-stage-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

The portable scratch regression uses the actual private maker/validator and shared strict directory methods, without Core/supply artifacts. It passed8 checks. The first-stage/error/redaction test uses actual recording/classification methods with PUBLIC errors and passed12 checks. Prior44 checks were not rerun; their harness only gained a nil error-summary field required to compile the unchanged lifecycle assertions in future CI.

The separately recorded installed-supply reproduction is intentionally artifact-dependent, not a generic CI assumption:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_public_search_preparation_delta.py <fresh-output> --qa-core-products <matching-build22-QA-Core-products>
```

That driver binds the actual installed PUBLIC supply, exact actual scratch code and unchanged profile/config callees. Old exit1 and new exit0 receipts remain separate. A narrow actual SDK27.2 check of the final diagnostic file, actual supply/adapter and exact ownership declarations passed against matched22 QA Core. No full app/ordinary22/backend build or GUI/target request ran in this repair. Parent owns the PUBLIC-only23 successor build/install and fresh single-query acceptance. Old22 observer paths/hashes cannot be transferred to a new23 installation; a new artifact-specific read-only observer binding is required.
