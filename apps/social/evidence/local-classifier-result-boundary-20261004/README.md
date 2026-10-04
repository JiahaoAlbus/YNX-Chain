# Device classifier result boundary

Original product snapshot: 29dcdc198b6841f6fa6adfa48f977d91d9d04ad9.

The new five tests were executed unchanged against the original Git module in an isolated directory using existing locked workspace dependencies. The original runner exited 1; its complete output is retained in original-red.txt. The successor related batch passed 17 tests, followed by TypeScript checking and Android Hermes export, all exit 0.

The product now validates runtime result shape and captures each category score exactly once. Null/undefined, missing scores and throwing bridge getters become classification_failed rather than rejecting the completion promise before input cleanup and slot release. A changing getter cannot swap a validated score before thresholding. Original caller bytes remain unchanged; only the module-owned snapshot is overwritten, without promising elimination of JS/runtime copies.

These tests use authorized ordinary text fixtures and controlled classifier result values, not a real classification model. No model-quality/offline inference/private UI/OS installation/security review/production authorization or full Social acceptance is established. No Wallet account, sign, transaction or deployment action was performed. The Android export path in the log is a temporary build output, not a durable release package.

The original and successor runner output, typecheck output, Android export output and batch exit summary are retained beside this document. Existing default-off, unavailable, folded, stale and final-byte render fences are preserved.
