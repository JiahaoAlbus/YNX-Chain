# YNX Calendar open questions

These are integration or external-input questions, not requests for ordinary engineering decisions.

1. **Wallet/Auth acceptance** — Which accepted central commit and health/version endpoint contains `ynx-calendar-v1`, exact callback binding, verifier/introspection, recovery, expiry, and revocation?
2. **Mail delivery** — Which canonical Mail envelope and idempotency key should Calendar use for invitation, update, RSVP, cancellation, and reminder delivery?
3. **Data Fabric events** — Which accepted schema/version owns Calendar canonical event publication and privacy-class redaction?
4. **AI Gateway deployment** — Which authenticated JSON POST/SSE endpoint is accepted for Calendar previews, and what provider/model/cost fields are mandatory?
5. **Website consumption** — Which public support, privacy, security, and status routes should Website bind to `/calendar` before publication?
6. **Release authority** — Which signer/notarization/store assets and release workflow are approved for Android, iOS, and macOS production classes?
7. **Cross-product baseline** — When will Integration rerun the repository-wide Go gate after consensus/IDE/Faucet/Trust owners repair the current failures?

Until direct evidence answers these questions, the corresponding release states remain false or in progress.
