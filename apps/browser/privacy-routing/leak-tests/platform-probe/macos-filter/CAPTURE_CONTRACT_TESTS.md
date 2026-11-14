# Per-operation output capture delta

These tests run only generated synthetic stdout children through exact owned
helper processes. They do not start Nym/Tor, a browser, NE, GUI, a new tunnel or
any network listener. They neither accept privacy qualification nor replace an
original backend. No keys, user files or profile contents are accessed. HOME is
obtained from `getpwuid` only to compare the current user's canonical directory
identity/mode; it is not listed or read, changed, or copied from environment.

```sh
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/test_capture_contract.py \
  --output "$RUNNER_TEMP/ynx-gate-capture"
```

Current-source CI builds only the actual C helper + IdentityBridge, synthetic C
fixture, and a tiny Swift slice containing the actual spec/ACK methods and error
type. It does not compile the whole target or rerun output-discard seven,
qualification eight, signed backend or GUI groups. The original macOS workflow
owner may upload `ynx-gate-capture/**`.

For an actual old/successor regression, also pass the immutable installed or
artifact-supplied build20 helper:

```sh
--old-helper '/abs/build20/YNXBackendStartGate'
```

The driver pins its actual bytes and never edits/re-signs the old application.
When absent, the baseline is explicitly NOT_SUPPLIED, while independent new
helper checks proceed. Current source tests do not infer that old artifact's
outcome from source or repeat its already retained evidence as a new run.

The local actual baseline used the build20 Nym-role helper, 75,680 bytes,
SHA256 `37d93bfa44f805e75c3b6f2a9fba18d25114b40a42d54afda82d83b939b922b6`.
With the real canonical synthetic target, it refused canonical HOME with 78.
It ignored the raised cap, refused a 1MiB synthetic body at 131,072 bytes, and
reaped the actual child. The driver retained this truncated outcome separately
from successful physical cleanup. Its absent new prepared-cap acknowledgement
is not accepted for raised operations by the new Swift spec.

Current helper checks cover unchanged default overflow rejection; explicit
1,048,576 and 2,721,227-byte JSON stdout complete through its actual final tail
and EOF; exact bytes/hash; valid HOME; fake HOME, unknown environment key and
NUL environment/argument rejection; bool/string/negative/fraction/zero/over16MiB/
null cap rejection; and discard-after-bootstrap raised cap rejection. Python
requires `outputCaptureComplete is True`/`is False`, never `1 == True`.
The actual spec/ACK slice covers legacy default missing ACK, exact raised ACK,
invalid bounds and absent/wrong/bool/string/fraction/null raised ACK.

Only real `childReaped` receipts for the same prepared PID are used. Physical
reap is distinct from complete output and exact byte count. Failed or timed out
cases retain helper PID, original failure and cleanup status. The driver closes
its own input and, if necessary, signals only its exact Popen helper, whose
handler reaps its own child. It never SIGKILLs the wrapper or signals discovered
child PIDs. Unconfirmed cleanup remains UNKNOWN with recorded handles; no retry
or replacement process hides it.

The first driver draft used an ASCII compile symlink as target, which correctly
failed the helper's canonical-path check before `prepared`. That first 78 is
retained but is **not** treated as the HOME regression. Runtime targets now use
the actual canonical output path; the compile alias is never a child operand.

The successful 17-case/14-spec-check receipt refers to its exact source snapshot.
Afterward only failure/PID retention and optional-baseline CI orchestration were
added to the driver and syntax checked; functional capture assertions/fixture
and parent production source were unchanged, and those groups were not rerun.
Signed route/NE/real Nym directory acceptance remains NOT_RUN.
