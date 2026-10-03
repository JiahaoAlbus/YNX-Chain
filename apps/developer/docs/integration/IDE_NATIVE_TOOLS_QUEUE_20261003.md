# Native Tools queued identity admission

Status: SOURCE_ONLY. Parent 1c72806d39448b584d88cc3085e236f62b400949.

Tools now supplies a trusted identity revalidation callback to the existing model scheduler. It runs at actual queue dispatch before the upstream request. Binding includes the identity reference along with owner/project/runtime/session/account/generation. Current and original expiry are checked at dispatch and completion. Periodic checks do not overlap. One-use review, cancellation and failed saved-request semantics remain.

Five real queue/loopback HTTP cases demonstrate that account/project/reference changes, revocation and expiry cannot send queued private context to the upstream service. A positive unchanged-admission case completes and saves the exact reviewed context once. Each retired case saves failure without answer and cannot reuse its review. The original source produced five failures, including actual upstream receipt of retired context.

86 relevant service checks and static check passed. The exact prior frontend/protocol artifact is reused after verifying all 71 build inputs unchanged. No browser/build rerun claimed for this backend-only batch. Raw original failures and test fixture corrections are preserved. Tests use controlled SSE rather than a production configured model.

A's formal release and real-user acceptance remain pending. Full native workbench, installed/public acceptance, capacity and MONSTER remain unverified. Network/package-egress/LXD remain stopped.
