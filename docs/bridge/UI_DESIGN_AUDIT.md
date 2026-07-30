# Bridge Interface Design Audit

`ynx-bridged` is currently an API and operator service, not an end-user application. It therefore has no standalone graphical interface to claim as complete.

Consumer interfaces must remain product-specific:

- Wallet owns quote and signing review.
- Pay shows funding-before-payment state.
- Exchange shows deposit and withdrawal lifecycle.
- DEX labels external routes.
- Finance remains read-only for exposure.
- Explorer links source and destination evidence.
- Monitor presents exposure, provider failure, pause, and reconciliation age.
- Trust owns dispute and appeal workflows.

Every consumer must distinguish loading, unavailable, permission failure, expired approval, source accepted, source finalized, destination pending, destination confirmed, failed, retry, refund/recovery, dispute, offline, and paused states. Twelve-language, Arabic RTL, keyboard, screen-reader, contrast, reduced-motion, dynamic-text, dark/light, and 390px evidence remains consumer-owned and is not claimed by this server branch.
