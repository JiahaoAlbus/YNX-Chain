# Native Matrix image picker lifecycle caller

The test renders the real NativeMatrixWorkspace component through a controlled React/React Native harness. Matrix, picker, platform lifecycle and randomness are controlled test dependencies, not a real device or admitted SDK session.

The unchanged original workspace produced exit 1. The repaired workspace produced exit 0 for four caller cases: background lock during picker, lock after confirmation while staging, unmount during nonce creation, and unchanged confirmed image send. No real image was uploaded and no private account, signature or transaction was requested.

The original source is retained as original-workspace.txt, which the esbuild TSX loader accepts explicitly. The first typecheck failed because the evidence copy had a .tsx extension and was incorrectly included as a product compilation unit with invalid relative import locations. The original failure is retained; moving only the evidence copy to .txt preserves it without weakening product typechecking. The corrected typecheck output is retained separately.

This is not whole Native Matrix, installed permission, staging cleanup, transport delivery, Social v2, crypto649, local model admission or MONSTER acceptance evidence. It prevents the specific old-view picker flow from proceeding after a lock or unmount.
