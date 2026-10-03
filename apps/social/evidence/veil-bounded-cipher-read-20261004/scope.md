# Native bounded cipher-stream prerequisite

Base: 071b8a62e76944817a5183fbccdc33a38464182e.
Dormant new code only; no SDK session copy/token export, native registration,
protocol activation, real network request, account/sign/tx or deployment.

VeilBoundedCipherRead owns the input and caps allocation at claimed exact length
validated1..2MiB. Reads in8KiB chunks with current native checks before/after;
exact-size overflow performs one extra byte probe, never drains a hostile tail.
Missing authority fails without reading; stream closes on all exits. Candidate
is wiped after IO/size/revocation/close failure and never published until close
and final native check succeed. It does not implement or authenticate transport.

VeilMatrixBoundedDownload composes the native reader with original-SDK stream
producer interface, interruptible IO handoff and cancellation-before-read close.
Producer is currently NONE: default VEIL_MATRIX_BOUNDED_STREAM_UNAVAILABLE.
No getMediaContent/getMediaFile fallback or parallel bearer HTTP client exists.
Upstream must genuinely stream with response/resource limits and finite native
socket timeouts/cancellation; InputStream cannot prove those properties. Native
coroutine/SDK/network cancellation and result handling have NOT been executed.

Actual pinned Matrix26.09.28 public API observation: getMediaContent returns
byte[], getMediaFile returns MediaFileHandle and neither takes byte cap/watcher;
ProgressWatcher is exposed for uploadMedia. RequestConfig has only retryLimit,
timeout,maxConcurrentRequests,maxRetryTime. ClientBuilder offers requestConfig,
not a public HTTP stream/body-cap hook in the inspected interface. A file-return
method alone does not establish bounded internal Rust buffering. Internal SDK
resource behavior remains UNKNOWN, not asserted unsafe from API absence alone.
Root has the exact source/SDK gap request; producer implementation is still an
internal development/integration item, not a request for human tokens/secrets.

Java21 compile0 and32 generated-input assertions PASS (zero keys/credentials).
Tests include exact/multi-chunk/max length, endless generated source limited to
expected+1 bytes, short source, missing/revoked/final-revoked authority, zero
progress, read/close IO failures with buffer wipe, invalid cap zero reads.
These are controlled InputStream checks, NOT actual SDK/HTTP/OS acceptance.
Kotlin2.1.20/JVM17 same-module compile0 with original native storage and current
pipeline against pinned Matrix API/API36. Two jar byte identities retained as
local compile candidates, not APK/IPA or platform installation proof.

Full Social/649/PQXDH/SPQR/groups/history/platform/public/dot gates remain OPEN.
Existing32/55cb limited results are not expanded by this candidate. Next requires
original SDK streaming/resource implementation with exact provenance/admission,
actual native downloader+cancellation/restore, then pipeline/UI/node checks.
