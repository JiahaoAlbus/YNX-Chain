# LINK → original Cloud private host integration

`link-cloud-private-host.integration.go.txt` is an external `securelink_test`
source template with build tag `link_cloud_host_integration`. Its exact new test is
`TestLINKCloudOriginalHostUnixLifecycleAndColdGeneration`. Root owns the
composition runner, frozen supplier validation, actual execution and evidence.
The template author does not run a second copy or rerun the existing suites.

The supplier is P04's complete `original-private-host-r1/source/internal/cloud`
package. `HANDOFF.json` is 4889 bytes, SHA256
`89b5f3ff683879d74be1d5155895d4f4450c0b62d496536c2cd0c1969c14a837`;
`SOURCE.json` is 15555 bytes, SHA256
`323eb9dd95b7dbcd45689ac1fe681fcb545d2cfcd6739c7762116c43dc677111`.
Root installs all 81 supplier Cloud `.go` leaves into one exclusive external
physical module. Importing a mutable Cloud checkout or mixing new factory files
with an older Cloud package does not qualify this test.

The actual normal dependency closure is separately frozen in P04's
`private-host-normal-dependencies-r1/LINK_SOURCE_CLOSURE_HANDOFF.json`, 3548
bytes, SHA256 `5a8f8a76bda01ac983660b28fb06adc266ff9739d4792bf5f8c7aa5f6b128e85`.
Its 60-leaf SOURCE is 14815 bytes, SHA256
`ebf2fc43fb9b6eed0f61c6b5bcd974020a5c7296049be4b982da4dda8ffd9c9e`.
The complete original developerauthority, ynxbatch and accountaddress packages
are installed, and the original binary-http-source module is installed unchanged
in the exclusive external run. Reference module files are provenance, not a
replacement for the workspace's current module versions. An external
physical module's `go.mod/go.sum` clones the workspace files and adds only the
SDK-supplied `ynx.local/auth/binary-http-source v0.0.0` declaration and its
relative local replacement. The runner records that explicit physical mapping,
disables remote module downloads, and leaves workspace modules untouched.
Initial missing-package and missing-local-module failures happened before test
execution and are retained separately; neither is authorization evidence.

The runner supplies an existing, explicit, canonical absolute 0700 directory
owned by the current non-root OS user through
`YNX_LINK_CLOUD_HOST_ARTIFACT_ROOT`. It must be on the external volume under
`/Volumes/`. The template creates a fresh `unix-cloud-*` child and retains its
original Cloud state, telemetry and exclusive phase JSON files. It never opens
existing user state. Separate endpoint generations use the original
`os.MkdirTemp("", "lch-")` + `ListenPrivate` mechanism with 0700 parent and
0600 socket; a real Unix path-limit failure fails the run without a fallback
path. Only these test-owned endpoint directories may be removed after drain.

The intended execution is the runner's single exact case, equivalent to:

```sh
CGO_ENABLED=1 GOMAXPROCS=2 /opt/homebrew/bin/go test -mod=readonly -p 1 -race \
  -tags=link_cloud_host_integration,securelink_openssl \
  ./internal/securelink \
  -run '^TestLINKCloudOriginalHostUnixLifecycleAndColdGeneration$' \
  -count=1 -v -json -timeout=60s
```

This command is a runner hook, not a claim that it has run. Root supplies the
existing OpenSSL environment and retained output directory; this leaf neither
downloads nor rebuilds a dependency. The UDS integration makes no new native
TLS handshake claim. Existing getter, Cloud constructor/consumer, native TLS,
P06 daemon and carrier results are reused separately.

The source-bound runner entry is:

```sh
node scripts/verify/link-cloud-private-host-check.mjs \
  /Volumes/西部数据/YNX-large-work/coordination-v5-20261031/owners/P04/original-private-host-r1/HANDOFF.json \
  /Volumes/西部数据/YNX-large-work/coordination-v5-20261031/shared/LINK/host-integration-next/NEW_EXCLUSIVE_RUN \
  --execute
```

Omit `--execute` to prepare the exclusive physical run and INPUT only. Use
`--compile-only` for tagged compile/default-vet with `-run '^$'`; this does not
execute the function or establish functional acceptance. The
runner requires the original OpenSSL 3.6.4 pkg-config headers and libraries,
records their real paths and hashes, and never substitutes a different native
profile or TLS implementation. It executes only this exact new main test and
retains raw Go JSON output and errors. A missing/failed/skipped main, source
drift, malformed event or child failure cannot qualify the run.

The original function did execute once under the earlier overlay layout and
passed in 12.85 seconds (package 14.210 seconds). That process returned 1 because
Go vet could not chdir to a virtual dependency directory, so it is not an
all-green job. The physical source composition fixes the directory layout and
retains vet; its tagged compile/default-vet passed separately with no function
execution. The exact Go fixture and all supplier source bytes are unchanged
between those records. Their combined functional/static evidence is retained;
the passed function was not repeated just to replace the earlier process status.

The case exercises the actual `cloud.OpenOriginalPrivateHost`, original
`host.Handler()`, `securelink.ListenPrivate`, `NewLocalCallerServer` and
`NewLocalCallerClient`. The wrapper performs full `FromRequest`/`Current`
capture before its private mutex and then calls `CurrentOriginalCaller` on the
same original request under that mutex. It does not create an Auth Store,
Source, Root, principal, grant or replacement Cloud handler. `/health` must
return original normal `ynx-cloudd` liveness; the original deployment handler
must return `IDE_DEPLOYMENT_AUTHORITY_UNAVAILABLE` with 503. A second client's
larger body allowance must still receive the registered server's 413 without
reaching Cloud. Neither the normal nor cold denied effect may create the
original `state.json.ide-deployments` journal.

For lifecycle checks, instrumentation wraps only the original response writer's
`Write`. It blocks while the real Cloud handler and its enclosing LINK handler
are both active. The same handler goroutine observes the original request's
`ctx.Done`; there is no detached observer. Client cancellation and an independent
actual Unix peer disconnect are each observed before the no-I/O getter is
expected to reject. The test does not expect the getter to discover an
unobserved remote close. Uncertain client errors retain the original
`DispatchError` and `DispatchPossible`; no request is retried or called a
business result, and no SDK `error.partial` contract is invented.

LINK retires first. Cancelled LINK Join and early Close must retain the blocked
handler; the actual Cloud parent identities remain unchanged. Cloud's early
Close must return `ErrOriginalPrivateHostChildrenRetained` while the real Write
is held, and its cancelled Join cannot claim drain. The exclusive
`03-FIRSTCAUSE-retained-original-write.json` is written before release. After
release, true LINK Join/Close precedes Cloud Retire/Join/Close. Later Cloud
Close still returns its original retained-child error even though cleanup has
completed. Each generation has a fresh bounded drain context.

Cold recovery opens a fresh original Cloud host over exactly the same retained
state paths and creates a distinct private endpoint. The old socket must still
have its original `os.SameFile` identity, a rebind must fail without changing
that identity, and the old fixed client and retained caller must stay denied.
The new endpoint performs separate health and denied-effect observations, not
a replay of an uncertain prior operation. Original `state.json` bytes must stay
unchanged; telemetry remains original Cloud output.

Cleanup releases every armed Write before waiting, retires the actual child,
joins its real handlers, waits for the accept loop and client goroutines, and
only then retires/joins/closes the original Cloud parents. Opening partials are
retained before errors are checked. A failed child Join retains the parents and
socket directory and reports the failure; cleanup never turns a timeout into
drain, deletes public evidence or replaces the first Close cause. All waits are
bounded. The test uses no parallel subtests, public listener, production keys,
accounts, funds, business approval, daemon or deployment.
