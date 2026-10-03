# Received attachment parent scope - engineering progress, not acceptance

Social-only parent wiring: NativeMatrixReceivedAttachment captures the exact
original client, event ID and returned target. Render-time scope checking hides
an old modal immediately if client/event changes, before passive effects. Effect
retires only the stale state; the existing viewer owns original preview cleanup.
Close callbacks clear only their own original selection object, including when a
new selection reuses the same client/event. Pending cleanup is cleared only when
it belongs to that callback's exact target. No session/auth/download semantics
changed, no synthetic production port or private content introduced.

Actual related tests: receivedAttachmentState.test.ts + original
nativeMatrixReceivedMedia.test.ts, 10/10 PASS, zero skipped. Android+iOS JS export
PASS. Full TypeScript check FAIL only on the previously introduced pending
nativeMediaPresentation.test.ts readonly-uri fixture error TS2540. Human repair
choice remains pending; do not claim full-project green. No new diagnostics for
the parent/state/test changes. Product dependency and lock files unchanged.

Known workspace state: previous viewer/render-gate changes and browser fixture
scripts/evidence remain uncommitted; preserved and not included in this source
commit. Native bundle checks run against this combined working tree and are not
an immutable source-only commit/installed artifact proof. Earlier browser proof
covered actual child viewer, NOT this parent change. Parent installed/UI runtime
verification remains NOT_VERIFIED. Raw logs accompany this checkpoint.

No deployment, account grant, sign/transaction or private data. Historical Matrix
runtime/device/node continuity, admitted model/calibration/native integration,
source-bound installed/public full-product user flows and actual dot/MONSTER
remain open. Social v2 NOT_COMPLETE; unique controller is
接续测试网生态审计工作, no separate Central single-use release lease issued.
