# Actual pinned pipeline in Node worker threads

Status: PROGRESS, Node mechanism QA only. Not browser/mobile/product acceptance.
Baseline ab652768ff77fd5930950e66f171002262dbeeec.
Owner branch codex/social-wallet-chooser-20261001.

The new local-inference-thread-qa.mjs reuses the original actual three-category
pipeline, not new classifiers or a replacement product consumer. Pipeline SHA256:
ba86a789f47dde48aa0aecad34bf982922885901b0c176d29825b518bbe9f911.
Actual Node 26.7.0, actual pinned onnxruntime-web 1.30.0 WASM, same four model
byte/SHA checks and public logo/gray inputs. No private image or account request.
Runtime module hash is checked before observation wrapper import.

The wrapper observes real InferenceSession.create/run entry and delegates their
original arguments and returns unchanged. It generates no scores. Parent observes
only input tensor names, not content data. Cancellation is scheduled on the first
actual encoder pixel_values run-entry message; this is NOT instruction-level
proof of where the native/WASM engine stopped.

Actual sequential checks:
- Complete: exit 0, 3 real composition checks, Worker threadId -1 after exit.
  Parent heartbeat 164 ticks, maximum sampled gap 22.375ms.
- Cancel at actual encoder entry: terminate resolved exit 1 in 3.738ms,
  Worker threadId -1, no final score document published. Parent heartbeat
  16 ticks, maximum sampled gap 22.628ms. Not a model or application crash.
- Complete after cancellation: fresh thread exit 0, 3 real composition checks,
  threadId -1. Parent heartbeat 160 ticks, maximum sampled gap 22.363ms.
All workers joined before the check finished; no unfinished worker handle.
Captured stderr is empty. Twenty-second diagnostic deadline was not reached.
These are actual bounded observations, not mobile/browser SLA promises or UI
render measurements. No late queued product-message acceptance is inferred.

The pre-existing localClassifierWorker.ts/test.ts remain unchanged/uncommitted.
Their synchronous factory-abort teardown bug and strict fixture type diagnostics
are still unresolved, and the human repair choice remains pending. This test
neither substitutes another product implementation nor bypasses that failure.
Full Social tests/typecheck are NOT claimed green by this Node result.

Required next gates remain: repair reviewed product port, actual browser/native
worker containment and cancellation, signed/admitted/calibrated real model bundle,
actual display/settings/no-preflash/error/recovery, original identity/Matrix,
source-bound installed/public release and genuine ordinary-user/dot acceptance.
MONSTER NOT_RUN. No filtering activation, release/deployment, private-key access,
Wallet grant/signature/transaction or other owners' service/data changes.
Only coordinator: 接续测试网生态审计工作.
