# YNX Video decisions

## 2026-07-27 — Preserve old HMAC state without weakening publication

Adding a non-optional `rights` JSON object would change the canonical representation of historical Video records and make a valid pre-upgrade state fail HMAC verification. `Video.Rights` is therefore an optional pointer with `omitempty`. New uploads must supply a complete rights declaration. Historical records remain readable but publication changes fail closed until rights are supplied through a future correction workflow.

## 2026-07-27 — Caller-declared checksum is mandatory

The service previously computed and stored SHA-256 but did not compare it with a caller-declared digest. The upload contract now requires a 64-character hexadecimal SHA-256 and compares it with the streamed digest using constant-time comparison. Browser Creator Studio computes the digest only on HTTPS or localhost.

## 2026-07-27 — Rights data is authoritative user input, not proof of ownership

Rights basis/source/license/territory/expiry and evidence hash are stored as a creator declaration. They do not constitute legal verification or permit the service to claim commercial rights. Human report/takedown/appeal boundaries remain mandatory.

## 2026-07-27 — Shared false-green gates are not accepted as evidence

Root placeholder and secret scripts print success when `rg` is missing because the absent command is executed in an `if` condition. YNX 33 will not modify the shared Security/SRE-owned scripts. Their result is recorded as invalid, product-specific independent scans will be used, and the defect is handed to YNX 30.

## 2026-07-27 — Do not cross-edit unrelated full-repository failures

Full `go test ./...` failures are outside Video ownership: key-permission tests in consensus/faucet/trust and missing IDE contract artifacts. Video remains responsible for documenting and retesting the gate, not for modifying those modules from this worktree.
