# Independent local QA client

Build a clean complete candidate on macOS ARM64:

```sh
node apps/network/qa/build.mjs --out-dir /absolute/independent/output --expect-head EXACT_40_CHARACTER_SHA
```

`--plan` captures the actual clean/dirty source, exact Go dependency/embed input hashes and target without packaging. The builder refuses dirty source, source changes during compilation, an existing versioned output and `/Applications` output. It uses the existing helper and original CORE proof executable, current embedded PWA, and system clang/Cocoa/WebKit. It does not invoke signing, notarization, installation or alter an existing App. Linker-produced signature observations are recorded separately from publisher signing.

The bundle's normal entries are `YNX Network QA.app` and `START.command`. `START.command --headless` runs the same packaged helper through its normal CLI; `--native-status` queries its actual kernel peer channel. `--version` prints QA build identity. The native shell displays the helper's one-use pairing code and confines navigation to that helper's exact loopback origin; it does not automatically approve or give browser tickets native authority. Quit stops only its owned helper.

Each exact source build uses its own private `~/.ynx-network-qa/qa-<identity>/` directory. Existing product directories and other versions are preserved. No independent chain trust context is bundled or inferred. The original offline proof tool is included under `Contents/Helpers`.

For isolated QA, `YNX_NETWORK_QA_DIRECTORY` may select a different QA root. It must already exist, be owned by the current user and have exact 0700 permissions; each build still uses its own `qa-<identity>` subdirectory. The launcher resolves this root with POSIX `realpath` before enforcing the IPC path bound. This task-specific setting never changes `HOME`, Foundation's user directory or profile contents, and cannot select an executable. With no setting, the normal App uses the real user's `~/.ynx-network-qa` as before.

Use **Configure independent proof materials…** in the native App to choose the original CORE public transaction trust context. Enter its exact 64-hex SHA256 obtained through an independent trusted channel. The field starts empty; the App never calculates a digest to fill or recommend this independent input. Do not select keys, account data or credentials. A matching digest only binds the selected public bytes: original context parsing, source authority and proof mathematics remain with the existing helper and original CORE executable. Missing original Source remains RPC_ONLY; configuration grants no verification, Wallet approval, funds or node administration.

Canceling either dialog or entering a mismatched digest preserves the existing configuration and running session. Apply validates the candidate, stops only this App's owned helper, waits for its actual exit, saves the profile and starts a new helper with a fresh one-use code. Browser tickets are not restored. Existing receipts and outboxes remain in the same version directory and receipt readback remains historical with `authority:false`.

Headless uses the same profile. With this QA version stopped:

```sh
./START.command --configure-proof-context /absolute/original-context.json --context-sha256 INDEPENDENT_64HEX
./START.command --proof-profile
./START.command --headless
```

The local profile contains only build/owner identity, original public context path and the independently entered digest. It cannot select a shell, executable or command; only the packaged helper and packaged original CORE verifier are used. Successful previous profiles are preserved. Unsafe permissions, damaged or foreign profiles, session-time replacement, and changed context bytes fail closed without deleting the original files or history. An active version session holds a kernel lock so a separate CLI cannot reconfigure it. This protects local QA process ownership; it does not turn same-user filesystem access into a cryptographic authority boundary.

A missing or changed public context stops helper startup. The native configuration entry remains available to explicitly choose new original material and enter its independent digest; the previous profile is archived and the changed original file is preserved. A damaged or foreign local profile cannot be overwritten through this recovery path.

`source-manifest.json` records HEAD, source state, exact source/embed hashes, compiler identity, executable SHA256, actual service version and observed signatures. QA build, functional process acceptance, GUI, install, publisher signing and public release are separate gates.

When the original CORE owner supplies a matching local QA verifier, the builder
accepts `--original-verifier /absolute/original-tool`,
`--original-verifier-sha256 INDEPENDENT_64HEX` and
`--original-verifier-source ORIGINAL_40HEX` together. It captures a regular,
current-user, non-writable-by-others executable without following a final
symlink, checks the independently delivered digest, and binds its bytes and
supplier source declaration into the build identity and manifest. The bundle
still uses one fixed internal tool; HTTP, proof profiles and GUI inputs cannot
select an executable. This QA intake is separate from publisher signing and
Source qualification. Original proof/context formats, clock and network gates
remain the original tool's responsibility.

The bundle's minimum macOS version is read from all packaged executable load
commands and recorded in `qa-build.json` and `Info.plist`. A supplied verifier
can require a newer macOS than the native launcher's baseline; that artifact
does not establish compatibility with earlier systems. Building on a host
older than the effective deployment target is refused.

## Designed client and public receipt export

The standalone window hosts the desktop/mobile light/dark client and all twelve
language catalogs from the user's supplied design. Network metrics are projections
of the actual fixed RPC reports, never design examples or multi-source claims.
The bundled original YNX brand and Font Awesome Free icons are local assets;
the App loads no third-party font/icon scripts.

Native public receipt export is a main-frame, exact-origin, bounded JSON bridge
to `NSSavePanel`. It accepts no arbitrary path, command or executable. The user
selects a new `.json` file; cancellation, stale navigation, overlap and existing
destinations preserve the original files. The exported envelope labels the
record historical and `authority:false`; `reportText` retains the original
numeric lexemes, while parsed JSON is not claimed to preserve original wire
numbers or independently verify its own receipt ID.

The native export contract is discovered by the existing `./cmd/...` Go test
entry as `TestP09QANativeExportBridgeContract`. It compiles and executes the
actual launcher functions against private temporary files on macOS, without
starting an App, helper or GUI; other platforms report an explicit skip.

The native QA bundle persists only the exact approved language and theme enums
in its own bundle preferences domain. A main-frame, exact-origin document-start
bootstrap restores them across helper port changes; browser pairing tickets,
trust and approvals are never stored or restored by this bridge. Appearance
changes affect this App only, and other QA versions retain their own domain.

Public receipt export is a single in-flight operation. The client displays
panel selection and saving separately and disables all three export entries
until the native result returns. Filesystem work stays off AppKit's main
thread. Cancel preserves the original record; a durability error is UNKNOWN,
not a saved or safely retryable result. A new document receives only an idle
notification for an older operation, never that older receipt's saved result.
Normal Quit during an approved write waits for that original operation, then
continues the existing owned-helper shutdown. No automatic export retry is
performed, and no Wallet/node authority comes from these lifecycle events.

## Fixed WASM task QA

The bundle also carries one fixed `ynx-network-task-worker`. Its executable digest
is compiled into the helper and checked by the native launcher. The nested
`apps/network/wasmworker` module pins its own dependencies without changing the
shared root module. `TestP09FixedWASMModuleContract` integrates its actual runtime
tests into the existing helper CI discovery; `TestP09TaskWorkerNativePackagePin`
executes six native package checks without taking the desktop.

The explicit controlled CLI accepts a signed manifest, a separately signed
consent fixture, two independently supplied public-key digest pins and bounded
public JSON bytes. It can only run the fixed import-free byte histogram module:
no submitted code, shell, file path, host import, WASI or network capability is
available to the guest. Input is at most 4 MiB, linear memory is fixed at 129
pages, output is exactly 1024 bytes and execution is at most five seconds. CPU
duty cycling and Go work-buffer admission are not OS CPU/RSS containment claims.
The helper independently recounts original bytes in Go before granting a
`CONTROLLED_SANDBOX` receipt, counts each receipt once, waits for its owned child
on Stop, and never resumes a worker on restart. Historical receipts require fresh
original signatures and independent recomputation before counting again.

For a reproducible local QA packet, create an empty current-user 0700 directory
and run `node apps/network/qa/controlled-wasm-fixture.mjs /absolute/private/qa`.
This reads only fixed public RPC `/status` and `/blocks/<height>` endpoints,
preserves original bytes and generates temporary Ed25519 fixture signatures.
Private keys are not written. Its public readback gives the two fixture key pins.
Run the exact packaged helper, using that directory and those pins:

```sh
"/absolute/YNX Network QA.app/Contents/Helpers/ynx-network-helper" \
  --run-controlled-wasm /absolute/private/qa/packet.json \
  --controlled-issuer-key-sha256 FIXTURE_ISSUER_PIN \
  --controlled-consent-key-sha256 FIXTURE_CONSENT_PIN \
  --data-dir /absolute/private/qa
```

The controlled CLI emits the original receipt, unique meter and actual worker
start count. Repeating the same unexpired packet reaudits the historical receipt
without starting another worker. It uses only its isolated `controlled-wasm`
journal; the normal App and native/HTTP resource service remain disabled. Neither
these signatures nor an RPC report establish production publisher authority,
human consent, block validity, reward or funds. Actual canonical publisher,
key epoch/revocation and visible native consent remain separate production gates.

## Native ordinary-node decisions

The ordinary App remains the read-only client while the original signed node
runtime is unavailable. A controlled WASM CLI packet does not enable App controls,
create native consent or supply that release. The native node IPC entry prepares
an exact manager/node/action/artifact/generation intent; production install/start
returns `UNSUPPORTED` before showing a prompt when the original release is absent.

For a supported owned-node effect, the helper invokes only the fixed native
producer captured from its own bundle. The builder compiles that producer's
digest into the helper; no HTTP request, intent, profile or runtime option can
select a prompt executable. `--native-consent` is a dedicated native child mode
with bounded stdin and no browser bridge. It displays the exact intent digest,
artifact, action, node, generation, mode and expiry. Cancel is the default button;
closing, timeout, client cancellation, invalid responses and changed binaries
cannot approve. Only a matching fresh child decision reaches the manager's
short-lived, peer-bound opaque approval, which is consumed once. This local
decision is not a publisher signature, Wallet approval, person identity proof,
validator/signer permission or Root authority.

The fixed native text supports the same twelve languages and Arabic RTL while
keeping hashes and original intent fields LTR. Language/theme enums are taken
from the App's existing preferences when its helper starts or restarts; this does
not claim live synchronization of an already running helper's prompt appearance.
No general environment, HOME override or caller-supplied display text reaches the
producer. A visible review has a bounded 60-second lifetime; only native node
effect transport requests receive the corresponding longer response budget.
Read-only and other IPC operations retain their short timeout and original scope.

`TestP09QANativeConsentContract` connects the actual Cocoa parser/display/response
contract to helper CI without opening a window. Its injected decisions and the
separate Go process transport fixtures do not establish a human click. Actual
dialog acceptance, original signed runtime intake and production release are
reported separately from this code and contract validation.

The producer is a fixed nested `YNX Network Consent.app`, with its own original
`Info.plist`, executable and build-specific bundle identifier. Both executable
and metadata digests are compiled into the helper. The private capture retains
that exact minimal App hierarchy and metadata; it does not turn the GUI producer
back into a bare command-line file. A fixed, read-only `--identity` mode reports
the actual Cocoa main bundle without creating `NSApplication`. Missing, replaced
or malformed metadata fails closed. Capture cleanup removes only its known files
and empty original directories; unknown or replaced contents are preserved.

This corrects an actual c08 GUI intake failure: CUA could not identify the bare
helper by name or path. Its original expiry response was retained as a process
result, not a clicked Cancel or observed GUI pass. The successor still requires
actual Cancel/confirm/expiry window acceptance; metadata and contract checks alone
do not establish that result. Native producer signing can remain independent of
the helper and outer App, preserving the original release owner's ordering.
