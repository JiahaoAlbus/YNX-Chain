# YNX Mail + Calendar 0.2.0 Testnet Preview

Release state: hosted unsigned Testnet Preview. Central integration, Web/API staging, public deployment, production signing and store release are not complete.

## Mail

- Completed persistent inbox/thread/compose/drafts/send review, YNX-local delivery state/retry, search, archive/spam, block/report/appeal, attachments, sender attestation and account export/deletion.
- Added strict HttpOnly cookie sessions, authenticated state envelopes and private-context AI JSON POST with preview/approval/cancel/review boundaries.
- Internet-wide delivery remains unsupported and is explicitly represented as `internet_mail_delivery_not_supported`.

## Calendar

- Completed preview-approved create/update/cancel, invitations/RSVP, reminders, IANA time zones, DST-safe recurrence, sharing, conflict review, offline recovery, revert and account export/deletion.
- Added real day/week/month views plus the same session, state-integrity and AI privacy hardening as Mail.

## Surfaces and accessibility

- Two independent Android and iOS identities, exact Wallet callbacks and 12 native locales including Arabic RTL.
- Web companions cover light/dark, mobile/tablet, RTL geometry, large text, loading, failure, empty and success states; Calendar additionally proves day/week/month.
- Android debug APKs were built, installed together, cold-launched, stopped/restarted and deep-link verified independently on API 36. GitHub Actions run `29652770138` independently built, installed, cold-launched and deep-link verified both unsigned Simulator apps.
- Unsigned macOS arm64 desktop archives were cleanly extracted, cold-launched, health/version verified and restarted; packages include install instructions and binary-derived SBOM evidence.
- Immutable preview assets, exact sizes and SHA-256 values are hosted at `https://github.com/JiahaoAlbus/YNX-Chain/releases/tag/ynx-mail-calendar-v0.2.0-testnet-preview-e227c4f`.

See `mail-calendar-evidence-index.md`, `mail-calendar-artifact-manifest.json`, each `product-release.json` and each `UI_DESIGN_AUDIT.md` for evidence and limitations.
