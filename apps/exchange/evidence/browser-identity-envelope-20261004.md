# Existing SSO identity envelope consumption

Inherited head `ef1d52d6b750341f26440946cd63087e8c0bf40c`. Shared `internal/productsessionv2/browser_sso.go` is read-only: Account returns signedIn/account/subject/generation/expiresAt/scopes/csrfToken/privateWorkspaceAuthorized. Browser random CSRF is 32 bytes encoded RawURLEncoding (43 URL-safe characters). This change consumes that existing envelope, without modifying shared SSO or creating another protocol.

Actual owned restore previously checked only scopes and privateWorkspaceAuthorized. The red regression demonstrated that a response missing account was accepted as browserIdentity and could retire a separate private account. The consumer now requires true signedIn, bounded nonempty whitespace/control-free account matching subject, positive safe generation, strict unexpired RFC3339 timestamp, the existing CSRF format, exact array identity:read-only scope and false privateWorkspaceAuthorized before any identity assignment or private-account transition.

Negative cases preserve Standard Wallet and make zero private disconnect/guest calls: missing/empty/whitespace/control account, wrong subject, false signedIn, zero/unsafe generation, invalid/expired timestamp, missing/short/invalid CSRF, extra scopes and claimed private authority. Valid matching identity still restores. No account approval, new proof or native signing is invoked.

Executed:

- Before fix: envelope regressions 1 PASS / 1 FAIL; missing account was accepted, not guessed.
- After fix: 2/2 PASS, 49.05175 ms.
- Actual Chrome guest identity route additionally receives seven malformed envelopes and proves no signed-in state, hidden logout, retained guest draft/URL and no non-GET requests: 1/1 PASS, 1918.541334 ms.
- Full `node --test --test-concurrency=2 apps/exchange/tests/*.test.mjs`: 212 total, 210 PASS, 0 FAIL, 2 conditional skips, 54340.038959 ms. Existing logout races and 12-locale identity fixtures now carry the actual shared envelope fields and original timestamp validator; no permissive replacement is used.
- `git diff --check`: PASS.

App SHA-256 `9ec33d8a1ca2e5ee11a904d001f1c6a8a815334d447a9ea5d412b51586ea5478`; HTML binds it. Prior engineering candidates remain immutable; this requires a new matching candidate. Public/installed/real-approval/private-write/transaction completion remains false until directly proved. Formal Host publisher remains A and remote UNKNOWN protections remain unchanged.
