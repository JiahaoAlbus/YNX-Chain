# PUBLIC Nym Native components

These tests consume actual Native source and a genuine built `YNXBrowserCore`
static archive/module. They do not start the SDK, Foundation `Process` adapter,
sockets, WebKit, an identity, or any normal route authority. Full Native normal
and acceptance-flag compilation remains the parent integration check.

Prepare the new bootstrap cohort without compiling it:

```sh
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 \
  apps/browser/privacy-routing/nym/tests/prepare-public-bootstrap-controls.py \
  --core-products "$CORE_PRODUCTS" --output "$FRESH_OUTPUT"
```

`CORE_PRODUCTS` must contain the actual built `libYNXBrowserCore.a` and
`YNXBrowserCore.swiftmodule/`; missing products are errors. `FRESH_OUTPUT` must
not exist. The preparer snapshots real inputs, records their SHA-256 values,
and emits `recipe.json`. The existing CI bounded process owner executes its
`compileArgv`, then `testArgv` as argument arrays, requiring original exit zero
and `expectedStdoutPrefix`. Compile cap is 30 seconds, control cap 5 seconds,
whole cap 60 seconds including 15 seconds cleanup. Local runs retain existing
resource floors and owned process/PGID cleanup. Logs and module cache belong to
that fresh output. A local Unicode external-disk TMPDIR requires an ASCII
symlink to the owned output's tmp directory; no global environment change.

The exact generated Native components and new test were byte-equal to the
executed bootstrap cohort on 2026-11-08 (compile 0, controls 0, all owned Popen
handles reaped). Recipe preparation does not re-run that cohort.

`NymPublicBootstrapControls.swift` tests final consumed configuration, protocol
v3, SURBs 20/3, exact provider and gateway observations. Missing fields, wrong
configuration/protocol/provider, wrong source/gateway, cross-stream half-lines,
late contradictory configuration, overlong lines and startup total-cap loss
cannot establish bootstrap. These are local bootstrap observations, not public
TLS, HTTP, SearchAvailable, LeakSafe or ReleaseApproved proof.

`NymPublicDataControls.swift` is the separately executed earlier DATA/metadata
cohort. Do not repeat it just to execute the new bootstrap controls.

The next reply-SURB observation has its own four pure DATA controls:

```sh
cd apps/browser/privacy-routing/nym/qa-glue
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest test_nym_reply_surb_observer -v
```

They do not authorize or perform a network experiment. The parent owns the
existing CI workflow and any new bounded network scope.

The offline supply producer is `prepare_public_native_supply.py` in the parent
directory. `prepare_supply(inputs, output)` accepts the pinned `directory`,
`runtime`, `directory_source`, `runtime_source`, `directory_receipt`,
`runtime_receipt`, and `license_directory` paths. The CLI accepts the same
names as hyphenated flags plus `--output` and `--receipt`. The output must be
fresh. The receipt records the verified bytes and modes of each staged file.
Stage the returned resource directory under `Contents/Resources/NymPublicRuntime`
before signing the enclosing PUBLIC app. Keep both executor byte hashes during
packaging. The parent can use the signed app's `--public-nym-check-only` entry
to verify the installed resources.

Run the new supply boundary controls on the existing CI host with:

```sh
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 \
  apps/browser/privacy-routing/nym/tests/test_public_native_supply.py -v
```

`test-public-native-fifo.py` exercises the actual Native scratch reader and
resource manifest loader with no-writer FIFOs. Use `--output` with a fresh
directory for CI's current-reader regression. To reproduce the earlier block,
also pass `--before-runtime` and `--before-data` from the preserved 4fdae6/c793
source snapshot. The driver checks the before source hashes and compiles only
the extracted readers and fixture. `RESULT.json` records the child wait status
for each requested case.

Run the PUBLIC route-loss component with a fresh output directory:

```sh
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 \
  apps/browser/privacy-routing/nym/tests/test-public-nym-route-loss.py --output "$FRESH_OUTPUT"
```

The fixture compiles the actual route fence, process owner and bootstrap
readers. It drives path updates through the runtime's fence boundary and
checks the original termination notification, exit code and both output pipes
of an owned local child. The controller's WebKit behavior requires its own
controlled probe.
