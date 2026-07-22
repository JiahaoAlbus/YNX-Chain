# Wallet recovery contract

Wallet recovery restores only the selected native account from offline key material. It never restores Product Sessions, product-device keys, approvals, sponsorship eligibility, exchange credentials, strategy mandates, Credentials, or AI consent. Those capabilities must be re-established through canonical Wallet approval and fresh device proof.

Recovery requires local biometric authorization, blocks screen capture while material is shown, writes secrets only through the platform secure-store adapter, validates the derived `ynx1` identity, and records a hash-chained audit event. A recovered account starts locked. Old sessions remain subject to central expiry and revoke state; operators must not infer revocation from a local reinstall.

The executable recovery and migration proof is in `src/storage/walletRepository.test.ts`. Backup/restore and service-stop drills are in `RECOVERY_DRILL.md`; external signer and physical-device drills remain release blockers and are listed in `release/operator-inputs.request.json`.
