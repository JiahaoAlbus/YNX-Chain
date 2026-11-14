# Social first-device Native Rust source candidate

This is a bounded **source candidate**, not a complete project, deployment, or
proof that first-device enrollment or chat works. It includes the matching
Rust owner code, original Cargo feature declarations and the actual Android
server-feature compile guard. Source hashes are recorded in `SOURCE.sha256`.

The eight C and header files from the complete local candidate are omitted:
their distribution rights have not been established from the available
project license and repository history. This omission includes the Source R5
guard, recovery reader, platform owner, platform header and C client bridge;
the Rust declarations therefore have no linked implementation here. The
omitted files are not represented by stubs.

## Actual status and dependencies

* This directory is **not independently buildable**. In addition to the C
  owners, it lacks the rest of the Native crate, internal Rust modules,
  workspace dependency definitions, linked crypto libraries, actual platform
  resources, selected keys and the server's same-thread SDK/Engine/R5 setup.
  Historical binaries do not establish this candidate's ABI. The server
  collector feature is forbidden on Android by the included compile guard.
* The device-original reader requires real same-Source participant and
  EngineAttempt, four signed role originals and an independent terminal and
  checkpoint. Directory DATA and public projections are not those originals.
* The close-only pin-release ABI ends a participant's read path and releases
  its extra Engine pin on the original thread. Zero means only that the pin is
  absent. Failure retains the original pin, owner and UNKNOWN; it does not
  solve abrupt thread death. A live `ServerParticipant::Drop` can still abort.
* Signer output lost between signing and durable admission is not recoverable
  from this code. Keep UNKNOWN and never re-sign or fabricate an output.
* The complete coupled Linux Rust/C build, physical TPM and worker lifecycle,
  signed-positive DEVICE fixture, installation and deployment are unverified.

## Verification

`tests/run-worker-controls.py` extracts the actual Rust registry slice and
compiles it with test doubles. It checks same-thread pin cleanup, reentry,
cancellation, partial preservation and first-cause handling. It does not use
a real signer, participant, TPM, Source or accepted-device fixture.

Set `BUILD_DIR` to a disposable location and optionally `RUSTC` to the matching
compiler, then run `python3 tests/run-worker-controls.py`. The included Cargo
manifest is provenance and feature information, not a standalone build plan.

## License and provenance

The original Native Rust crate's manifest declares `AGPL-3.0-only`; the
corresponding complete license text is retained in `LICENSE`. No third-party
source, binary, runtime records, keys, test-device data or evidence archive is
included. The corresponding C source is excluded pending provenance review.

The source reconstructs the P02 same-participant lifetime, DEVICE-original
reader and read-pin cleanup candidates. The preimage-manifest and input patch
SHA-256 identifiers are below. These hashes describe source provenance only;
they are not Git commits, permission, or evidence of a real resource.

```
baseline file manifest: 845157839b22371300001b7927240624055bffb1371eb7a80be2c954d5ff4d03
same-participant patch:  0f3feec8a70ce49bc749e30a0045970f178d8232c42804af96002c2e2fb440e4
DEVICE originals patch: b43cf16ccfe7ff6572e1ff810f260fde10c0d4aa2eacf3176958914c7c173ce0
read-pin cleanup patch: f830be9f8e044c08e6490ace61fd03055c15cbd1cbbb6be87934a26dd69e513a
```
