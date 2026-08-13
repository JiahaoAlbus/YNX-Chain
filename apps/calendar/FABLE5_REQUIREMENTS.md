# Fable5 product 36 requirement ledger

Authoritative source: `YNX_Chain_Fable5_Coordinated_Ultimate_Goal_Prompts.md`, section `36｜YNX Calendar`.

This ledger is the pre-development and pre-release checklist for Calendar. A
backend method, a UI control, a test, and public evidence are separate facts.
`Implemented` never means publicly accepted unless the public-evidence column
also names direct evidence.

| Requirement | Runtime / UI state | Direct test state | Public evidence / remaining gap |
| --- | --- | --- | --- |
| Day / Week / Month | Web implemented | Browser screenshots | Public build `55587bb6` verified with ComputerControl |
| Agenda | Web implemented | Browser recurring/search proof | Public build `55587bb6`; direct interactive public proof remains |
| Create / edit / cancel / revert | Service + Web implemented | Unit + browser preview/approval | Public create only available as device-local guest until Wallet Web handoff works |
| Title / description / location / link | Service + Web implemented | Round-trip and browser proof | Public build `55587bb6` exposes all fields |
| Start / end / all-day / time zone | Service + Web implemented | Round-trip, invalid-zone and DST tests | Public build `55587bb6` exposes all fields |
| Reminder | Persistent local channel implemented | Restart/no-duplicate test | Mail/push provider delivery is not integrated |
| Color / personal / team / shared classification | Versioned shared-calendar objects, colors and event membership implemented | Round-trip, owner/editor/viewer/revoke tests | Public deployment and interactive shared-calendar proof remain |
| Search | Web occurrence search implemented | Browser exact/no-result proof | Public build `55587bb6`; server-side full-text indexing is not implemented |
| Cloud attachment references | Bounded HTTPS references implemented | Unsafe Wallet-authority link rejection | YNX Cloud authorization and attachment lifecycle are not integrated |
| Offline / recovery | Approval-preserving queue + authenticated backup/restore | Unit, browser and statectl drills | Cross-device sync and production restore are not accepted |
| Export / delete / audit | Account JSON export, guest JSON/iCalendar export, exact delete phrase, audit UI | Unit + browser tests | Hosted immutable authenticated export policy remains |
| Invite by YNX Handle | Service + Web input implemented | Unknown/duplicate invite rejection | Requires real Wallet sessions and Mail notification integration |
| RSVP accept / tentative / decline | Service + event inspector implemented | Two-user authorization test | No public two-user proof yet |
| Invitation update / cancellation / organizer / attendee | Persistent event lifecycle, immutable attributed comments, and account activity notifications implemented | Update/cancel/revert/comment/notification authorization and read-state tests | Public build `55587bb6`; external Mail/push delivery remains |
| Duplicate / replay / privacy | Mutation IDs, version checks, Wallet replay rejection, privacy metadata | Replay/tamper/stale tests | Central Data Fabric event acceptance remains |
| Daily / weekly / monthly / yearly recurrence | Versioned schema v1 implemented | Unit recurrence tests | Public build `55587bb6`; public series-management walkthrough remains |
| Interval / ByDay / ByMonthDay / count / end date | Service + Web implemented | Boundary and DST tests | Browser proof covers interval/ByDay; full UI matrix still required |
| Single occurrence / future / entire series update | Service and event-inspector controls implemented | Atomic/replay/recovery/browser tests | Public interactive proof remains |
| Recurrence cancellation / recovery / DST | Service implemented | Dedicated unit tests | Public interactive proof remains |
| Owner / editor / viewer share and revoke | Shared-calendar lifecycle, permission manager and availability-only redaction implemented | Owner/editor/viewer/availability/revoke tests | Public interactive two-user permission proof remains |
| Conflict overlap / recurrence / time zone / buffer / attendee availability | Owner overlap plus per-event preparation/travel buffers and explicitly shared attendee availability implemented; attendee details redact to Busy | Unit owner/recurrence/buffer/authorization/privacy tests; browser buffer round-trip | Public build `55587bb6` plus ComputerControl control proof |
| Alternative-time suggestions | Deterministic weekday conflict-free drafts are generated for single timed events; selecting one returns to the editor and never auto-moves the event; AI adapter remains optional | Unit no-auto-move plus authenticated/guest browser selection tests | Public build `55587bb6`; ComputerControl preview proof; AI provider success is not proved |
| AI agenda / conflict explanation / follow-up | Context preview, approve, cancel, apply/reject implemented | Unit tests | AI does not mutate events; public provider availability remains unproved |
| English-first + 12 locales + Arabic RTL | Shared catalogs and RTL implemented | Catalog parity + browser screenshots | New fields and every dynamic error are not yet fully translated |
| A11y / dark / reduced motion / 390 px | Web implemented | Browser automated names + screenshots | Current-source public English UI and guest creation rerun with ComputerControl |
| Web / Android / iOS / macOS | Source projects present | Web proven; historical native checks | Current-source Android/iOS/macOS install and cold launch remain |
| Two-user Event→Invite→RSVP→Update→Cancel | Service test implemented | Unit test | Real public two-user Wallet flow remains |
| Shared Calendar / permission end-to-end | Create/list/share/role-change/revoke plus event access implemented | Dedicated owner/editor/viewer/revoke lifecycle test | Public two-user Wallet proof remains |
| Notification / Mail integration | In-app invitation, RSVP, comment, calendar permission and revoke notifications implemented with unread state; Mail remains a contract dependency | Multi-user notification lifecycle, availability privacy, and browser notification-center tests | Public build `55587bb6` plus ComputerControl fail-closed proof; external Mail/push and product 25 integration remain |
| `/calendar` micro-site and hosted artifacts | Metadata exists | Release schema checks | Website route and immutable current-source downloads remain |

## Rule for every subsequent Calendar slice

Before implementation, re-read product 36 in the authoritative prompt. After
implementation, update only the affected rows above, run focused unit/race/UI
tests, capture visual evidence, commit and push, deploy the exact commit, then
use ComputerControl against the public URL. Any missing row keeps Calendar
active.
