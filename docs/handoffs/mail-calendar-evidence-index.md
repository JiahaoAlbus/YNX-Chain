# Mail + Calendar evidence index — 2026-07-19

`pass-local`, `pass-ci` and `hosted-preview` do not imply central integration,
staging deployment, production signing or store release.

| Requirement | Evidence | State |
| --- | --- | --- |
| Mail domain | `go test -race ./internal/mail`; auth-cookie, draft/send/retry, attachment, Trust, export/delete, tamper/recovery and AI adapter coverage | pass-local |
| Mail backup/restore current source | `0e087bc1fe7f71732d28dab1a6c7414e28d424ce`; `TestBackupRestorePreservesProviderRecoveryAndSenderIdentity`, tamper/layout/key negative tests, no-replace concurrency and legacy-state forward-load | pass-local; prior-binary rollback not verified |
| Calendar domain | `go test -race ./internal/calendar`; preview/approve/revert, RSVP/share, DST/recurrence/conflict/reminder, export/delete, tamper/recovery and AI adapter coverage | pass-local |
| Product contracts | `npm test --prefix apps/mail`: 9/9; `npm test --prefix apps/calendar`: 6/6; exact release schema and 12 native locales | pass-local |
| Browser runtime | real ephemeral services, HttpOnly cookies, zero page errors; desktop light/dark, mobile, tablet, RTL, large text, loading/failure/empty/success and Calendar day/week/month | pass-local, screenshots inspected |
| Android package/build | `682bdb075803a77c9591fc59b83708944ea76fdf`; JDK 17 + Android SDK 36 Gradle build; `app-debug.apk` SHA-256 `92214dd2…81448`, 6,393,187 bytes | pass-local, debug/test signed |
| Android install/restart/deep link | `YNX_MAIL_API_36`; versionCode 2/versionName 0.3.0-test installed, two force-stop cold starts, Wallet callback route resolved and process remained alive | pass-local, emulator evidence |
| iOS source/project | `682bdb075803a77c9591fc59b83708944ea76fdf`; Swift parse plus plist/pbxproj lint; marketing 0.3.0/build 2 | pass-local static verification |
| iOS build/install/cold/deep link | Current source blocked because complete Xcode/Simulator is unavailable; historical GitHub Actions `29652770138` remains evidence only for `e227c4f0505537b19f4588ea26478c54518f0a4c` | current blocked; historical pass-ci unsigned Simulator |
| Desktop compile/package/install/restart | `682bdb075803a77c9591fc59b83708944ea76fdf`; exact-commit unsigned archive SHA-256 `42c8cde2…af73`, 2,782,558 bytes; extracted cold start and restart passed | pass-local, unsigned macOS arm64 |
| Dependency/license | `mail-calendar-dependency-review.md`; runtime module and development-only audit | reviewed-preview |
| Hosted artifacts | GitHub prerelease `ynx-mail-calendar-v0.2.0-testnet-preview-e227c4f`; server-reported SHA-256 digests and sizes match local manifest | hosted-preview |
| Central Wallet/Gateway/AI | exact proposed contract in `mail-calendar-central-integration.json`; no main merge, target deployment or live end-to-end proof | not-integrated |
| Web/API staging | GCP credential requires interactive reauthentication; Vercel ephemeral state rejected as non-durable | not-deployed |
| Public/store/production signing | no product URL, cross-region proof, production certificate or store approval | not-released |

Internet provider delivery is implemented only as a fail-closed local adapter and remains disabled without verified provider, domain, DNS, webhook and abuse-operations evidence. Calendar reminder/invitation evidence is local product state only.
