# Mail + Calendar evidence index — 2026-07-19

`pass-local`, `pass-ci` and `hosted-preview` do not imply central integration,
staging deployment, production signing or store release.

| Requirement | Evidence | State |
| --- | --- | --- |
| Mail domain | `go test -race ./internal/mail`; auth-cookie, draft/send/retry, attachment, Trust, export/delete, tamper/recovery and AI adapter coverage | pass-local |
| Calendar domain | `go test -race ./internal/calendar`; preview/approve/revert, RSVP/share, DST/recurrence/conflict/reminder, export/delete, tamper/recovery and AI adapter coverage | pass-local |
| Product contracts | `npm test --prefix apps/{mail,calendar}`; 6/6 each including exact release schema and 12 native locales | pass-local |
| Browser runtime | real ephemeral services, HttpOnly cookies, zero page errors; desktop light/dark, mobile, tablet, RTL, large text, loading/failure/empty/success and Calendar day/week/month | pass-local, screenshots inspected |
| Android package/build | Gradle `:app:assembleDebug`; APK SHA-256 and bytes match GitHub asset digests | pass-local, debug/test signed |
| Android install/restart/deep link | dedicated API 36 emulator-5560; both apps installed together, cold-launched, stopped/restarted and exact callbacks resolved independently | pass-local |
| iOS source/project | local Swift parse plus plist/pbxproj lint | pass-local |
| iOS build/install/cold/deep link | GitHub Actions `29652770138` at `e227c4f0505537b19f4588ea26478c54518f0a4c`; independent unsigned Simulator build/install/cold/callback, app ZIP, evidence and inspected screenshot | pass-ci, unsigned Simulator |
| Desktop compile/package/install/restart | `proof:desktop` builds exact-commit archive, extracts into clean directory, verifies UI + health/version, stops/restarts, emits evidence JSON and SBOM | pass-local, unsigned macOS arm64 |
| Dependency/license | `mail-calendar-dependency-review.md`; runtime module and development-only audit | reviewed-preview |
| Hosted artifacts | GitHub prerelease `ynx-mail-calendar-v0.2.0-testnet-preview-e227c4f`; server-reported SHA-256 digests and sizes match local manifest | hosted-preview |
| Central Wallet/Gateway/AI | exact proposed contract in `mail-calendar-central-integration.json`; no main merge, target deployment or live end-to-end proof | not-integrated |
| Web/API staging | GCP credential requires interactive reauthentication; Vercel ephemeral state rejected as non-durable | not-deployed |
| Public/store/production signing | no product URL, cross-region proof, production certificate or store approval | not-released |

Internet-wide Mail is explicitly unsupported. Calendar reminder/invitation
evidence is local product state only.
