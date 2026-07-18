# Mail + Calendar evidence index — 2026-07-18

All state labels below describe the current run. `pass-local` is not a deployment or central-integration claim.

| Requirement | Evidence | State |
| --- | --- | --- |
| Mail domain | `go test -race ./internal/mail` including auth-cookie, draft/send/retry, attachment, Trust, account export/delete, tamper and AI adapter tests | pass-local |
| Calendar domain | `go test -race ./internal/calendar` including preview/approval/revert, RSVP/share, DST/recurrence/conflict/reminder, account export/delete, tamper and AI adapter tests | pass-local |
| Web contracts | `npm test --prefix apps/mail` and `apps/calendar` | pass-local |
| Browser runtime | `npm run browser:proof --prefix apps/{mail,calendar}`; real ephemeral service, HttpOnly cookie, zero page errors, named controls; light/dark/mobile/tablet/RTL/large-text/loading/failure/empty/success and Calendar day/week/month | pass-local |
| Android builds | Gradle `:app:assembleDebug`, SDK `/Users/huangjiahao/Library/Android/sdk`; APK hashes recorded in handoff | pass-local, debug signing |
| Android install/cold launch | API 36 `emulator-5576`: both installs `Success`; Mail `COLD` 3900 ms, Calendar `COLD` 6297 ms; exact callbacks resolve | pass-local |
| iOS source/project | Swift frontend parse plus plist/pbxproj lint for both | pass-local |
| iOS build/install/cold | GitHub Actions run `29646181372` at `3c2ef1e7984e328756bba8ef95a6ca08259e728d`; independent unsigned Simulator builds, installs and cold launches; downloaded screenshots inspected and hashed | pass-ci, unsigned Simulator |
| Desktop | both Go desktop binaries build; embedded Web surface exercised at desktop/tablet/mobile widths | feasible-local |
| Central Wallet/Gateway | proposed contract in `mail-calendar-central-integration.json`; no main merge or target deployment evidence | not-integrated |
| Staging/public/download | no URL, remote health, hosted artifact or production signing evidence | not-deployed |

Internet-wide Mail is explicitly unsupported. Calendar reminder/invitation evidence is local product state only.
