# Card TEST source recovery dialog intake

Base source: aa2732d4057bff575bf85e22242cb76b8b1b0185. Branch: codex/card-test-service-recovery-20261002.

GuestExperience now consumes an actual task dialog for CARD_API_SOURCE_MISMATCH or CARD_API_SOURCE_UNAVAILABLE from the existing business/provider client error channels. It does not open for unknown codes, does not substitute a Wallet error, and does not remove the underlying private service error or loosen source validation.

Actions:
- Keep the current page or continue to Guest Overview without changing account, private permissions, application state or records.
- On Web only, offer a page reload as two explicit steps. The second step warns about unsaved form edits and explicitly says stored records are not cleared and Wallet/Card authority is not granted.
- Native has no fake Web-reload action. Modal onRequestClose dismisses the task; no automatic native authorization is attempted.
- A dismissed error can reopen only after the source-error condition clears and returns. No repeated prompt loop for one unchanged error.

Presentation: twelve locales, current-locale safe private error text, scalable Card typography, 48px action minimums, modal accessibility isolation and semantic heading/buttons. Controlled renderer tests passed for locale text, touch sizes, dismissal, reappearance, two-step reload, no private storage writes and no account requests. Actual browser keyboard/focus, small-screen layout and delivered reload behavior remain formal-public QA gates; renderer tests do not substitute for those observations.

Regression: 295 + 39 + 29 + 11 = 374 passed, no failures/skips. Frontend and separate server typecheck passed. Logs are under evidence/20261003-testnet-operations/card-source-dialog-final-*.

No formal source-bound build/deployment was executed here. The sole release owner must deliver the resulting exact commit/tree with the fixed reviewed backend/runtime compatibility tuple, then inspect the actual dialog and confirm Guest journal recovery from the preceding source. Keep real approval, signature, Card activation, YNXT credit and complete business lifecycle unverified until direct evidence. No real issuing, PAN/CVV, fiat, real merchant payment, AICardAPI or Live path is introduced.
