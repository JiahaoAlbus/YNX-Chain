# Owned export single-flight

Reviewed predecessor: b6b41552542e3d74c61d7b967d6426335b2eb89d.
Branch: codex/exchange-sso-cookie-binding-20261002.

Fail-first production-controller regression proved two identical pending export
clicks created two requests. The production export controller now coalesces the
same path/filename for the current account context and identity generation.
Separate export formats remain independent. New account contexts can start their
own export immediately; an old operation cannot delete the newer operation or
download its old-account blob. Success/failure releases only its own operation,
so the user can explicitly retry. Blob URLs remain revoked after initiating the
download. No export cache or background retry is introduced.

Actual Chromium regression executes the real production export button handlers
with controlled API Blob responses. It observes real browser download events:
duplicate clicks produce one request and one download; a stale owner response
produces none; the new owner response produces one. This is local UI evidence,
not public authenticated export or real Wallet evidence.

Validation commands/results:

- Owned read + browser suites: 12/12 PASS, 0 skipped, 6424.869333 ms.
- Owned read/save/browser/AI + 12-locale suites: 30/30 PASS, 0 skipped,
  51047.524917 ms. Browser startup/download test took 46192.973916 ms in this
  combined run; its isolated run passed in 1626.399125 ms. No failed checks were
  suppressed or converted into passes.
- Node syntax and git diff whitespace checks: PASS.

Only Finance ordinary business UI/tests/evidence are changed. Shared Wallet/Auth,
server exports, permissions and release graph are unchanged. Final release
integration/public deployment/person-owned export/install gates remain unproved;
this source checkpoint does not complete the ecosystem goal.
