# Authorized popup QA correction and executed browser result

Parent source a4219312f1729fd416d69dba17c264e26de79c75 / tree 12193cc3cefefa0c043cd0c43723e7a6695fc72a.
Root explicitly authorized the missing harness brace correction. Only that syntax defect was corrected; no expectations, actor or cryptographic identity changed. node --check apps/social/scripts/matrix-qa/popup.mjs PASS, then actual isolated Chromium run four checks PASS: completion, explicit cancellation, timeout, switching account before callback. Direct actual popup URL was verified to be fixed fixture homeserver /_matrix/client/v3/auth/m.login.sso/fallback/web?session=... rather than blank staging.

The first FAILED_BEFORE_BROWSER receipt remains unchanged. The original INTEGRATION/SHA256SUMS describe the historical a421 failed-harness snapshot; FOLLOWUP-SHA256SUMS binds the repaired QA plus current source and new executed evidence. This avoids rewriting historical failures as successes.

The popup server is an explicitly isolated ENGINEERING callback fixture. It exercises actual button clicks/window callbacks/consumer cleanup, NOT real Synapse OIDC/UIA authentication. It does not generate Matrix tokens or delete devices. Production upstream must still advertise real SSO, validate same actor and accept the exact original session's DELETE. The new actual-Matrix whoami actor/device guard is covered by policy tests, not a real SSO success receipt.

Source consumer + policy: 21/21 targeted PASS. Actual dual-homeserver: 13 PASS from a421 source, including original encrypted room and offline text/attachment recovery after process close, injected persistence failure native disk retention and independent process reopen. Actual extra device: four checks PASS followed by confirmed deletion FAILED/401/empty flows. Real deletion, token invalidation/new Megolm exclusion and production ordinary user/Native remain NOT_RUN after that failure. No administrator/AS/password bypass was performed.

Public RP issuer/client/homeserver deployment identity remains A-owned and unverified. Legacy v2, original device/keys/caches and earlier failures preserved. Private popup browsers closed and both private QA homeservers/network stopped. No user profile/device, shared source, host change, deployment or account/sign/chain request.
