# QA directory body failure observation

R10's pinned directory executor exited on `qa-directory-body-idle`. That
label is shared by Basic, Described, and Epoch, after an accepted HTTP 200,
MIME, and advertised-size check. Its terminal observation retained only the
label. The prior response resource, page, and decoded byte count are unknown.

This patch is additive to the original QA transport leaf. The body failure
path keeps the existing error and emits a single bounded
`YNX_NYM_QA_BODY_FAILURE_V1` JSON frame on stderr. The frame contains the
existing run ID, resource and page, reason, expected decoded size when known,
accepted bytes on this page and in the session, and nonempty chunks. It carries
neither raw response headers nor response bytes. The directory command still
requires a complete decoded body and matching current epoch. Original per-page
and session caps, absolute deadline, positive-progress idle limit, request
ordering, no-retry behavior and TLS checks still apply.

`qa-glue/qa_directory_body_failure.py::public_body_failure` validates the frame
from a future successor executor. Pass original bounded stderr, the active
run ID, the existing fixed error labels, and a true terminal capture only
after the original nonzero wait, both EOFs, and both descriptors' closure.
Record its result alongside the original first failure. Existing pinned
launchers remain bound to their previous binary and source hashes.

The cached dependency fixture compiles the exact candidate module and drives
real reqwest body reads against an owned numeric loopback HTTP server. It
checks a stall before the first byte, a partial body stall, successful
segmented reading, the reqwest read-timeout error path, absolute lease expiry,
and parsing of the emitted frames. The test uses short local timings. The
candidate's production constants remain 20 seconds for body idle and at most
120 seconds for the plan. The command accepts the original vendor source
root, matching `target/release` cache and rustc, and a fresh output path.
It writes its command and original wait results to `RESULT.json`.

`build-release.py` prepares a private copy of the 6dce source and cache.
The preparation checks the original source inventory and changes only
`common/http-api-client/src/qa_directory.rs`. Its execute mode takes the
shared original-A build mutex before invoking Cargo with the pinned lockfile,
`--offline --release --locked --jobs 1`, and the QA-only feature. The build
receipt requires the original Cargo wait, executable SHA-256, version, and
strict code-signature verification.

`run-directory-once.py` consumes the verified build receipt and an independent
scope with a bounded start window. It launches one fixed-origin directory
attempt in a fresh private directory, captures the original child status and
both pipes, and leaves a finite diagnostic receipt. The transport uses the
compiled numeric endpoint with TLS hostname and trust-root verification.
The optional fresh-route scope consumes only the complete, still-current
directory from that same process. It permits one official synthetic profile
init and one fixed DuckDuckGo request over the original runtime's SOCKS5
domain path. A failed directory closes the run before profile init.

`test-directory-once.py` uses a harmless child to verify nonzero wait,
both EOFs, the body diagnostic, and the one-attempt boundary. It does not
open a network connection.
