# YNX 20 Next Execution Slice

Implement production-client key custody for the existing AES-256-GCM client-encryption envelope while preserving the rule that Cloud never receives or recovers raw keys.

Required deliverables:

1. Versioned recovery-package, key-rotation and key-destruction records bound to exact product, account, context ID and version.
2. Hardware-backed/OS-keystore adapter contracts with explicit unavailable and unsupported states.
3. Fail-closed tests for lost key, wrong account, stale package, rollback, duplicate context, interrupted rotation and package tampering.
4. Operator and user documentation that explains unrecoverable loss, backup responsibilities, rotation recovery and safe support boundaries.
5. Updated exact evidence, release truth and integration handoff.
6. Node, static, security, Go, Race, push and exact-SHA GitHub Actions verification.

Do not modify other product Worktrees. Do not claim public deployment, production recovery, provider KMS, hosted artifacts, production signing or release without direct evidence.
