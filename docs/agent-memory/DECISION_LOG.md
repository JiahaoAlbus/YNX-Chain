# Decision Log

## 2026-07-29 — Preserve exact product identity before editing

The MCP workspace, Fable5 Worktree, `codex/final-cloud` branch and `JiahaoAlbus/YNX-Chain` remote matched. Editing was authorized only after those facts and local/remote SHA equality were verified.

## 2026-07-29 — Keep encryption keys user-held

The client-encryption candidate uses Web Crypto AES-256-GCM. The service receives only ciphertext and bounded metadata. Raw keys are not sent to Cloud and YNX cannot claim plaintext recovery.

## 2026-07-29 — Generate nonces internally

Caller-supplied AES-GCM nonces were removed from the public API. This prevents routine callers from accidentally reusing a nonce with the same key. Deterministic tests rely on behavior assertions rather than exposing unsafe production controls.

## 2026-07-29 — Authenticate context, not just ciphertext

Authenticated additional data binds the envelope to exact `product`, `account`, `contextId` and `version`. Cross-product, cross-account or rollback substitution fails authentication.

## 2026-07-29 — Separate website status from runtime deployment

An HTTP 200 response at `/cloud` proves only that the official website serves a product-status route. The deployed bundle marks Cloud as a local candidate and references stale source `7b3c5f427c17`; `deployedPublic` therefore remains false.

## 2026-07-29 — Correct legacy domain authority

Cloud web callbacks were changed from legacy `ynx.network` staging addresses to canonical `ynxweb4.com` product routes. No `huangjeo.com` product URL was introduced; valid `mcpXX.huangjeo.com` service domains remain untouched.

## 2026-07-29 — Do not publish a misleading release

No GitHub Release, hosted image or production package was created because central acceptance, provider proof, production signing and public runtime evidence are absent. Candidate code and successful CI are not a production release.

## 2026-07-29 — Retain exact CI report with bounded claims

The downloaded Trivy report is retained and SHA-256 bound. A successful configured Critical/High scan is recorded as time-, database-, severity- and scanner-scoped, not as proof of zero vulnerabilities or production security.
