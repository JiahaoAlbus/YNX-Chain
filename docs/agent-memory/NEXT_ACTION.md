# Next Action

Implement a production-client key-custody contract for the existing AES-256-GCM envelope without adding server-side plaintext recovery:

1. Define versioned recovery-package, rotation and key-destruction records with explicit product/account/context binding.
2. Add adapters for hardware-backed or OS-keystore storage while keeping raw keys out of logs, URLs, metadata and Cloud APIs.
3. Add tests for lost-key, wrong-account, rollback, rotation interruption, stale package, duplicate context and recovery-package tamper failure.
4. Update `CLIENT_ENCRYPTION_e05db0b.json`, `product-release.json`, integration handoff and operator documentation with exact boundaries.
5. Run Node, static, security, Go and Race gates; commit, push and verify the exact SHA’s GitHub Actions result.

Do not upgrade public, production, hosted-download or recoverable states unless direct provider and deployment evidence exists.
